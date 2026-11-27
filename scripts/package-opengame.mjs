import assert from 'node:assert/strict';
import { chmod, cp, mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { nativeComponents, runFile, sha256, writeAtomic, writeJSON } from './runtime-assets.mjs';
import { distributionFiles } from './distribution.ts';
import { packageTemplateConfig } from '../shared/template-config.ts';
import { checkReleaseLocks } from './package-npm.mjs';
import { checkReleaseVersion, releaseTemplateEnvironment } from './release-version.mjs';
import { buildGameTemplateBundles, offlineGame } from './game-template-publication.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const packageNamePattern = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;

async function removeDependencySourceMaps(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await removeDependencySourceMaps(file);
    else if (entry.isFile() && entry.name.endsWith('.map')) await rm(file);
  }
}

function stripVisionRuntime(runtime) {
  const stripped = structuredClone(runtime);
  delete stripped.vision;
  for (const target of Object.values(stripped.targets || {})) delete target.vision;
  return stripped;
}

function rewriteGuideLinks(text, file, commit, localPaths = new Set()) {
  const directory = path.posix.dirname(file);
  const link = (target, image = false) => {
    if (/^(?:#|[a-z][a-z\d+.-]*:|\/\/)/i.test(target)) return target;
    const pathname = target.split(/[?#]/, 1)[0];
    if (localPaths.has(path.posix.join(directory, pathname).replace(/\/$/, ''))) return target;
    const base = image ? 'https://raw.githubusercontent.com/nexu-io/opengame/' : 'https://github.com/nexu-io/opengame/blob/';
    return new URL(target, base + commit + '/' + (directory === '.' ? '' : directory + '/')).href;
  };
  return text
    .replace(/(!\[[^\]\n]*\]\()([^\s)]+)(\))/g, (_, start, target, end) => start + link(target, true) + end)
    .replace(/(\]\()([^\s)]+)(\))/g, (_, start, target, end) => start + link(target) + end)
    .replace(/(<img\b[^>]*\bsrc=["'])([^"']+)(["'])/g, (_, start, target, end) => start + link(target, true) + end)
    .replace(/(<a\b[^>]*\bhref=["'])([^"']+)(["'])/g, (_, start, target, end) => start + link(target) + end);
}

/**
 * Build an immutable OpenGame npm package (outer launcher + nested game-profile application archive).
 * Keeps Game Studio and Hyperframes trailer support while stripping video-only skills, video templates,
 * showcase media, Python/OpenCV vision runtime, and non-offline game sources.
 */
export async function packageOpenGame(
  output = path.join(root, 'dist/opengame-local'),
  version,
  templateEnvironment,
  { bundleRuntime = false, packageName = 'opengame', gamesRoot = path.join(root, 'templates/games') } = {},
) {
  output = path.resolve(output);
  assert.match(packageName, packageNamePattern, 'Invalid OpenGame npm package name: ' + packageName);
  assert(packageName.length <= 214, 'npm package name is too long');
  const explicitVersion = version !== undefined;
  if (explicitVersion) checkReleaseVersion(version);
  const templateConfig = packageTemplateConfig(templateEnvironment ?? (explicitVersion ? releaseTemplateEnvironment(version) : 'prod'), 'hosted');
  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const lockfile = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'));
  const rawRuntime = JSON.parse(await readFile(path.join(root, 'scripts/runtime-lock.json'), 'utf8'));
  checkReleaseLocks(pkg, lockfile, rawRuntime);
  const runtime = stripVisionRuntime(rawRuntime);
  for (const target of Object.values(runtime.targets)) {
    for (const key of nativeComponents(target)) {
      assert.equal(new URL(target[key].url).protocol, 'https:', 'Native sources require HTTPS');
      assert.match(target[key].sha256, /^[a-f0-9]{64}$/, 'Pin native SHA256: ' + key);
    }
  }

  version ??= pkg.version + '-local.1';
  const { mcpRegistry } = await import('../mcp.ts');
  const registry = mcpRegistry('game');

  await mkdir(output, { recursive: true });
  assert.equal((await readdir(output)).length, 0, 'Use a new output directory; OpenGame build artifacts are immutable');
  const temporary = await mkdtemp(path.join(output, '.build-'));
  try {
    const application = path.join(temporary, 'application');
    const installer = path.join(temporary, 'installer');
    await mkdir(application);
    await mkdir(path.join(installer, 'scripts'), { recursive: true });
    const commit = (await runFile('git', ['rev-parse', 'HEAD'], { cwd: root })).trim();

    const defaultGamesRoot = path.join(root, 'templates/games');
    const customGamesRoot = path.resolve(gamesRoot) !== path.resolve(defaultGamesRoot);
    const resolvedGamesRoot = path.resolve(gamesRoot);
    const gameCards = new Set();
    const games = await buildGameTemplateBundles(resolvedGamesRoot);
    for (const id of Object.keys(games)) {
      const prefix = `templates/games/${id}/`;
      const card = JSON.parse(await readFile(path.join(resolvedGamesRoot, id, 'game.json'), 'utf8'));
      gameCards.add(prefix + 'game.json');
      if (card.cover && !/^(?:[a-z]+:|\/)/i.test(card.cover)) gameCards.add(prefix + card.cover);
    }

    const files = await distributionFiles('game', file => (!bundleRuntime || !file.endsWith('.map'))
      && (!file.startsWith('templates/games/') || (!customGamesRoot && (file.startsWith(`templates/games/${offlineGame}/`) || gameCards.has(file)))));
    const localPaths = new Set(files);
    for (const file of files) {
      let directory = path.posix.dirname(file);
      while (directory !== '.' && !localPaths.has(directory)) {
        localPaths.add(directory);
        directory = path.posix.dirname(directory);
      }
    }
    for (const name of files) {
      const destination = path.join(application, name);
      await mkdir(path.dirname(destination), { recursive: true });
      if (/^(?:README|CONTRIBUTING|docs\/).*\.md$/.test(name)) {
        const guide = await readFile(path.join(root, name), 'utf8');
        await writeAtomic(destination, rewriteGuideLinks(guide, name, commit, localPaths));
      } else {
        await cp(path.join(root, name), destination);
      }
    }
    if (customGamesRoot) {
      await cp(path.join(resolvedGamesRoot, offlineGame), path.join(application, 'templates/games', offlineGame), { recursive: true });
      for (const rel of gameCards) {
        const from = path.join(resolvedGamesRoot, rel.slice('templates/games/'.length));
        const to = path.join(application, rel);
        await mkdir(path.dirname(to), { recursive: true });
        await cp(from, to);
      }
    }

    // Stamp the dedicated OpenGame MCP profile inside the packaged application only.
    await writeJSON(path.join(application, 'shared/mcp-release.json'), { profile: 'game' });
    await writeJSON(path.join(application, 'shared/template-config.json'), templateConfig);
    const gameTemplates = { schemaVersion: 1, games };
    await writeJSON(path.join(application, 'templates/game-downloads.json'), gameTemplates);
    await writeJSON(path.join(application, 'shared/build-info.json'), { commit, product: 'opengame', packageName });
    const skills = (await readdir(path.join(application, 'skills'))).sort();

    // Pure-JS outer npm scripts (Node cannot strip TypeScript inside node_modules).
    for (const name of [
      'runtime-assets.mjs',
      'npm-runtime.mjs',
      'opengame-hosts.mjs',
      'opengame-check-mcp.mjs',
      'opengame-updater.mjs',
      'opengame-launcher.mjs',
      'diagnostics.mjs',
      'diagnostic-redaction.mjs',
      'zip.mjs',
    ]) {
      await cp(path.join(root, 'scripts', name), path.join(installer, 'scripts', name));
    }
    await cp(path.join(root, 'shared', 'game-workflow-adapt.mjs'), path.join(installer, 'scripts', 'game-workflow-adapt.mjs'));
    await chmod(path.join(installer, 'scripts/opengame-launcher.mjs'), 0o755);

    const installerPkg = JSON.parse(await readFile(path.join(root, 'packages/opengame/package.json'), 'utf8'));
    assert.equal(installerPkg.private, true, 'Keep source packages/opengame/package.json private; publish only explicitly versioned artifacts');
    installerPkg.name = packageName;
    installerPkg.version = version;
    installerPkg.private = !explicitVersion || templateConfig.environment !== releaseTemplateEnvironment(version);
    installerPkg.publishConfig = {
      access: 'public',
      registry: 'https://registry.npmjs.org/',
      tag: version.includes('-test.') ? 'candidate' : 'stage',
    };
    await writeJSON(path.join(installer, 'package.json'), installerPkg);
    await cp(path.join(root, 'packages/opengame/README.md'), path.join(installer, 'README.md'));
    await cp(path.join(root, 'LICENSE'), path.join(installer, 'LICENSE'));

    pkg.version = version;
    lockfile.version = version;
    lockfile.packages[''].version = version;
    await writeJSON(path.join(application, 'package.json'), pkg);
    await writeJSON(path.join(application, 'package-lock.json'), lockfile);

    let bundledDependencies;
    const npm = process.env.npm_execpath || path.join(path.dirname(process.execPath), process.platform === 'win32' ? 'node_modules/npm/bin/npm-cli.js' : '../lib/node_modules/npm/bin/npm-cli.js');
    if (bundleRuntime) {
      assert(Object.values(runtime.targets).some(target => target.platform === process.platform && target.arch === process.arch),
        'Build prebuilt npm dependencies on a supported target machine');
      await runFile(process.execPath, [npm, 'ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: application });
      await removeDependencySourceMaps(path.join(application, 'node_modules'));
      bundledDependencies = {
        platform: process.platform,
        arch: process.arch,
        lockSHA256: await sha256(path.join(application, 'package-lock.json')),
      };
      await writeJSON(path.join(application, '.bundled-dependencies.json'), bundledDependencies);
    }

    const archive = path.join(output, `opengame-application-${pkg.version}${templateConfig.environment === 'dev' ? '-dev' : ''}.tar.${bundleRuntime ? 'xz' : 'gz'}`);
    await runFile(
      process.platform === 'win32' ? path.join(process.env.SystemRoot, 'System32/tar.exe') : 'tar',
      [bundleRuntime ? '-cJf' : '-czf', archive, '-C', application, '.'],
      { env: { ...process.env, COPYFILE_DISABLE: '1' } },
    );

    const manifest = {
      schemaVersion: 1,
      product: 'opengame',
      packageName,
      version: pkg.version,
      format: 'npm',
      templateEnvironment: templateConfig.environment,
      commit,
      gameTemplates,
      run: process.env.GITHUB_RUN_ID || null,
      attempt: process.env.GITHUB_RUN_ATTEMPT || '1',
      application: { url: './' + path.basename(archive), sha256: await sha256(archive) },
      ...(bundledDependencies ? { bundledDependencies } : {}),
      locks: {
        npm: await sha256(path.join(application, 'package-lock.json')),
        native: await sha256(path.join(root, 'scripts/runtime-lock.json')),
      },
      mcp: {
        profile: registry.profile,
        serverName: 'opengame',
        tools: registry.tools.map(tool => tool.name),
      },
      skills,
      runtime,
    };

    await mkdir(path.join(installer, 'payload'));
    await cp(archive, path.join(installer, 'payload', path.basename(archive)));
    await writeJSON(path.join(installer, 'payload/release-npm.json'), manifest);

    const packed = JSON.parse(await runFile(process.execPath, [npm, 'pack', '--json', '--ignore-scripts', '--pack-destination', output], { cwd: installer }))[0];
    const installerFile = path.join(output, packed.filename);
    manifest.installer = { version, packageName, url: './' + packed.filename, sha256: await sha256(installerFile) };
    const manifestPath = path.join(output, explicitVersion ? 'release-npm.json' : 'release.local.json');
    await writeJSON(manifestPath, manifest);
    for (const file of [archive, installerFile, manifestPath]) {
      await writeAtomic(file + '.sha256', `${await sha256(file)}  ${path.basename(file)}\n`);
    }
    return {
      packageName,
      version,
      installer: installerFile,
      installerBytes: packed.size,
      application: archive,
      manifest: manifestPath,
      skills,
      tools: manifest.mcp.tools,
    };
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const envFlag = args.find(arg => arg.startsWith('--template-env='));
  const pkgFlag = args.find(arg => arg.startsWith('--package-name='));
  const bundleRuntime = args.includes('--bundle-runtime');
  const positional = args.filter(arg => arg !== envFlag && arg !== pkgFlag && arg !== '--bundle-runtime');
  console.log(JSON.stringify(await packageOpenGame(
    positional[0],
    positional[1],
    envFlag?.split('=')[1],
    { bundleRuntime, packageName: pkgFlag?.split('=')[1] || 'opengame' },
  ), null, 2));
}
