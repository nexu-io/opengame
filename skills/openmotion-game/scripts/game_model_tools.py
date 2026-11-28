"""Dispatch scoped asset operations to reviewed, locally installed upstream tools."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import shutil
import stat
import subprocess
import sys
import tempfile


ANIM = {
    'identify': ('scripts/identify_engine.py', '4b78dc95d15c09a35a7232efd9294b85ee245a6a487f538cc50f0e2746552fed'),
    'inventory': ('scripts/inventory.py', 'caf34f218d8465d0c1d2c904f723f935fdae627d65ffe812f25de9c9409698ff'),
    'validate': ('scripts/catalog.py', 'dca4d183c8427096ead05a9ac16e437cde17f04832a2447446d64bf9f30bb2a0'),
}
UNITY = ('unity-asset-extraction/scripts/extract_unity_assets.py', '5f609108bba7793fbf777e3f8dc6b6f659c4837182a1d0bbd8b8574e7641cd0e')
UEX = {'Linux': '4002709a99db7df73e684c48d605fef1fac50f7e8a2e8f43d4550a087cb60f4b',
       'Windows': '762bb222ffdd29a52e4411b8e4e0b0c57dc6ba39354fde0e71dd585808048809'}


def verified(path, expected):
    with path.open('rb') as stream:
        if hashlib.file_digest(stream, 'sha256').hexdigest() != expected:
            raise ValueError(f'Upstream SHA-256 mismatch: {path}')
    return path


def source_path(path):
    source = path.resolve(strict=True)
    if source.is_dir():
        if source in (Path.home(), Path(source.anchor)):
            raise ValueError('Choose a specific project or asset directory')
        for folder, dirs, files in os.walk(source, onerror=raise_error):
            for name in dirs + files:
                item = Path(folder, name)
                if item.is_symlink() or getattr(item.lstat(), 'st_file_attributes', 0) & stat.FILE_ATTRIBUTE_REPARSE_POINT:
                    raise ValueError(f'Linked input is outside the supported scope: {item}')
                if not (item.is_dir() or item.is_file()):
                    raise ValueError(f'Expected regular file or directory: {item}')
    elif not source.is_file():
        raise ValueError('Expected regular input file')
    return source


def raise_error(error):
    raise error


def collect_uex_export(temp, stage, output, result):
    # CUE4Parse can write literal Windows filenames in the Linux working directory.
    prefix = str(stage).replace('/', '\\') + '\\'
    for entry in temp.iterdir():
        if os.name == 'posix' and entry.name.startswith(prefix):
            relative = Path(entry.name[len(prefix):].replace('\\', '/'))
            if relative.is_absolute() or '..' in relative.parts or not entry.is_file():
                raise ValueError('Unexpected uex export filename')
            target = stage / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            if target.exists():
                raise ValueError(f'Duplicate export: {relative}')
            entry.rename(target)
    for item in result['data']['items']:
        paths = []
        for name in item.get('files', []):
            path = Path(name.replace('\\', '/')).resolve(strict=True)
            relative = path.relative_to(stage)
            if not path.is_file():
                raise ValueError(f'Missing export: {relative}')
            paths.append(str(output / relative))
        if paths:
            item['files'] = paths
        elif item.get('ok'):
            raise ValueError('uex reported success without a file')
    output.mkdir()
    try:
        shutil.copytree(stage, output, dirs_exist_ok=True)
    except OSError:
        shutil.rmtree(output)
        raise
    result['data']['outDir'] = str(output)


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__)
    operations = parser.add_subparsers(dest='action', required=True)
    for action in (*ANIM, 'unity-inventory', 'unity-extract', 'unreal-index', 'unreal-search', 'unreal-export'):
        command = operations.add_parser(action)
        command.add_argument('input', type=Path, help='authorized input file, directory, or Paks folder')
        if action.startswith('unreal-'):
            command.add_argument('--uex', default=os.getenv('OPENMOTION_UEX') or shutil.which('uex'))
            command.add_argument('--version', required=True, help='upstream engine enum, e.g. GAME_UE4_27')
            command.add_argument('--mappings', type=Path, help='supplied .usmap file for unversioned packages')
        else:
            env = 'OPENMOTION_UNITY_EXTRACTION' if action.startswith('unity-') else 'OPENMOTION_ANIMVAULT'
            command.add_argument('--checkout', type=Path, default=os.getenv(env), help=f'upstream root (or ${env})')
        if action in ('unity-inventory', 'unity-extract', 'unreal-export'):
            command.add_argument('--output', required=True, type=Path, help='fresh output directory')
        if action == 'unity-extract':
            command.add_argument('--assetripper', type=Path, help='trusted upstream-pinned Windows AssetRipper executable')
        if action == 'unreal-search':
            command.add_argument('query', help='literal substring in a virtual package path')
            command.add_argument('--all', action='store_true', help='include non-package files')
            command.add_argument('--offset', type=int, default=0)
        if action == 'unreal-export':
            command.add_argument('package', help='virtual package path from search')
    return parser.parse_args()


def run(args):
    action = args.action
    source = source_path(args.input)
    if (action.startswith('unreal-') or action in ('identify', 'inventory')) and not source.is_dir():
        raise ValueError('Expected an input directory')
    if action == 'validate' and not source.is_file():
        raise ValueError('Expected a manifest JSON file')
    if hasattr(args, 'output'):
        output = args.output.absolute()
        if output.is_symlink() or output.exists() or output.resolve().is_relative_to(source):
            raise ValueError('Choose a new output directory outside the input')
        output = output.parent.resolve(strict=True) / output.name
    if not action.startswith('unreal-'):
        if args.checkout is None:
            raise ValueError('Set --checkout to the verified upstream checkout')
        name, digest = ANIM.get(action, UNITY)
        script = verified(args.checkout / name, digest).resolve()
        command = [sys.executable, '-I', '-B', script]
        if action == 'validate':
            verified(script.with_name('manifest_schema.json'), '8c5b21660eb345558e2f11980242dc25f4ff6b9b9f4865cf7a4c00613d7a4917')
            if subprocess.run([sys.executable, '-I', '-c', 'import jsonschema'], stderr=subprocess.DEVNULL).returncode:
                raise ValueError('Use a Python environment with jsonschema installed for full manifest validation')
            command.extend(['validate', source])
        elif action in ANIM:
            command.extend([source, '--json'])
        else:
            command.extend(['--input', source, '--output', output])
            if action == 'unity-inventory':
                command.append('--inventory-only')
            elif args.assetripper:
                command.extend(['--backend', 'assetripper', '--assetripper', args.assetripper.resolve(strict=True)])
        env = dict(os.environ, PYTHONSAFEPATH='1', PYTHONNOUSERSITE='1')
        env.pop('PYTHONPATH', None)
        env.pop('PYTHONHOME', None)
        return subprocess.run(command, env=env).returncode

    if platform.system() not in UEX or not args.uex:
        raise ValueError('Install uex v0.1.0 on Linux x64 or Windows x64 and set --uex or OPENMOTION_UEX')
    binary = verified(Path(args.uex), UEX[platform.system()]).resolve()
    if any(char in str(source) for char in ('$', '%')):
        raise ValueError('uex expands environment variables in paths; choose a directory without $ or %')
    profile = {'paks': str(source), 'version': args.version, 'recursive': False}
    if args.mappings:
        mappings = args.mappings.resolve(strict=True)
        if not mappings.is_file() or mappings.suffix.lower() != '.usmap' or any(c in str(mappings) for c in '$%'):
            raise ValueError('Expected a local .usmap file without path expansion characters')
        profile['mappings'] = str(mappings)
    with tempfile.TemporaryDirectory() as temp:
        config = Path(temp, 'profile.json')
        config.write_text(json.dumps({'games': {'input': profile}}), encoding='utf-8')
        if action == 'unreal-index':
            command = ['info']
        elif action == 'unreal-search':
            if not args.query.strip() or args.offset < 0:
                raise ValueError('Provide a search term and non-negative offset')
            command = ['search', '(?:' + re.escape(args.query) + ')', '--limit', '200', '--offset', str(args.offset)]
            if args.all:
                command.append('--all')
        else:
            if not re.fullmatch(r'/?[\w ()-]+(?:/[\w ().-]+)+', args.package) or '..' in args.package:
                raise ValueError('Expected a virtual package path returned by search')
            stage = Path(temp, 'export').resolve()
            stage.mkdir()
            command = ['export', args.package, '--mesh-format', 'Gltf2', '--out', stage]
        process = subprocess.run([binary, *command, '--game', 'input', '--config', config],
                                 cwd=temp, timeout=180, stdout=subprocess.PIPE)
        if action == 'unreal-export' and process.stdout:
            result = json.loads(process.stdout)
            if 'items' in (result.get('data') or {}):
                collect_uex_export(Path(temp), stage, output, result)
                print(json.dumps(result))
                return process.returncode
        sys.stdout.buffer.write(process.stdout)
        return process.returncode


if __name__ == '__main__':
    try:
        sys.exit(run(parse_args()))
    except (OSError, ValueError, subprocess.TimeoutExpired) as exc:
        sys.exit(str(exc))
