import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runFile, sha256, writeAtomic, writeJSON } from './runtime-assets.mjs';
import { checkReleaseVersion, releaseTemplateEnvironment } from './release-version.mjs';

export function validateOpenGameGuideSpec(name, version) {
  assert.match(name || '', /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/, 'Require an npm package name');
  assert(name.length <= 214, 'npm package name is too long');
  checkReleaseVersion(version);
  return version.includes('-test.') ? 'test' : 'stable';
}

export function validateOpenGameGuideIdentity(pkg, manifest) {
  const channel = validateOpenGameGuideSpec(pkg.name, pkg.version);
  assert.equal(pkg.private, false, 'Only public release candidates may have a public OpenGame installation guide');
  assert.equal(pkg.version, manifest.version, 'Package and embedded manifest versions differ');
  assert.equal(manifest.schemaVersion, 1, 'Unsupported release manifest');
  assert.equal(manifest.mcp?.profile, 'game', 'OpenGame installation guide requires the game MCP profile');
  assert.equal(manifest.templateEnvironment, releaseTemplateEnvironment(pkg.version), 'Template environment must match the release channel');
  assert.equal(pkg.bin?.opengame, 'scripts/opengame-launcher.mjs', 'Missing OpenGame launcher bin entry');
  assert.match(manifest.commit || '', /^[a-f0-9]{40}$/, 'Require the built source SHA');
  for (const hash of [manifest.application?.sha256, manifest.locks?.npm, manifest.locks?.native]) {
    assert.match(hash || '', /^[a-f0-9]{64}$/, 'Require release checksums');
  }
  const targets = Object.values(manifest.runtime?.targets || {});
  assert(targets.length > 0 && targets.every(t => t.platform && t.arch && (t.platform === 'darwin' || t.minimumOS)), 'Require native target declarations');
  return channel;
}

export async function generateOpenGameInstallGuide(tgz, output, candidate = false) {
  const readEntry = async entry => JSON.parse(await runFile('tar', ['-xOf', path.resolve(tgz), entry]));
  const pkg = await readEntry('package/package.json');
  const manifest = await readEntry('package/payload/release-npm.json');
  const channel = validateOpenGameGuideIdentity(pkg, manifest);
  const digest = await sha256(tgz);
  const packageSpec = `${pkg.name}@${pkg.version}`;
  const values = {
    VERSION: pkg.version,
    PACKAGE_SPEC: packageSpec,
    CHANNEL: channel,
    COMMIT: manifest.commit,
    TGZ_SHA256: digest,
    TARGETS: Object.values(manifest.runtime.targets).map(t => `${t.platform}/${t.arch}${t.minimumOS ? ` (${t.minimumOS}+)` : ''}`).join(', '),
  };
  const template = await readFile(new URL('../docs/opengame-install.md', import.meta.url), 'utf8');
  const text = (candidate ? '> Build preview only: this candidate is not an approved registry installation entry.\n\n' : '')
    + template.replace(/^If you are reading this file.*\n\n/m, '').replace(/\{\{([A-Z0-9_]+)\}\}/g, (_, key) => {
      assert(Object.hasOwn(values, key), 'Unknown installation placeholder: ' + key);
      return values[key];
    });
  assert(!text.includes('{{'), 'OpenGame installation guide has unresolved placeholders');
  await mkdir(output, { recursive: true });
  await writeAtomic(path.join(output, 'install.md'), text);
  const record = {
    schemaVersion: 1,
    product: 'opengame',
    candidate,
    packageName: pkg.name,
    version: pkg.version,
    packageSpec,
    channel,
    templateEnvironment: manifest.templateEnvironment,
    commit: manifest.commit,
    tgzSHA256: digest,
    applicationSHA256: manifest.application.sha256,
    locks: manifest.locks,
    guideSHA256: await sha256(path.join(output, 'install.md')),
  };
  await writeJSON(path.join(output, 'install-record.json'), record);
  return record;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert([4, 5].includes(process.argv.length) && (process.argv[4] === undefined || process.argv[4] === '--candidate'),
    'Usage: opengame-install-guide.mjs <opengame.tgz> <output-directory> [--candidate]');
  console.log(JSON.stringify(await generateOpenGameInstallGuide(process.argv[2], path.resolve(process.argv[3]), process.argv[4] === '--candidate')));
}
