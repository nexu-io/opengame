import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { GameProjects } from '../game-projects.ts';
import { zip } from '../scripts/zip.mjs';
import { readProjectZip } from '../shared/project-zip.ts';

function zipAttributes(data: Buffer) {
  const end = data.length - 22;
  assert.equal(data.readUInt32LE(end), 0x06054b50);
  const entries = new Map<string, { host: number; mode: number }>();
  let offset = data.readUInt32LE(end + 16);
  for (let index = 0; index < data.readUInt16LE(end + 10); index++) {
    assert.equal(data.readUInt32LE(offset), 0x02014b50);
    const nameLength = data.readUInt16LE(offset + 28);
    const name = data.subarray(offset + 46, offset + 46 + nameLength).toString();
    entries.set(name, { host: data[offset + 5], mode: data.readUInt32LE(offset + 38) >>> 16 });
    offset += 46 + nameLength + data.readUInt16LE(offset + 30) + data.readUInt16LE(offset + 32);
  }
  return entries;
}

async function exportGame(t: TestContext) {
  const root = await mkdtemp(path.join(tmpdir(), 'game-export-launcher-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const service = new GameProjects(root, path.join(root, 'templates'), path.join(root, 'kits'));
  const { game } = await service.create({ prompt: 'Portable game', multiplayer: false, genre: null, style: null, setting: null });
  return { root, archive: await service.exportZip(game.id) };
}

test('exported macOS launchers carry executable Unix file permissions', async t => {
  const { archive } = await exportGame(t);
  const attributes = zipAttributes(archive.data);
  assert.deepEqual(attributes.get('Start-Mac.command'), { host: 3, mode: 0o100755 });
  for (const name of ['index.html', 'serve.mjs', 'Start-Windows.bat', 'PLAY-README.txt']) {
    assert.equal(attributes.get(name)?.mode ?? 0, 0, `${name} must not become executable`);
  }
  const files = readProjectZip(archive.data);
  assert.match(files.get('Start-Mac.command')!.toString(), /^#!\/bin\/bash\n/);
  assert.ok(files.has('index.html'));
});

test('a standard Unix unzip restores the generated launcher execute bits', async t => {
  if (process.platform === 'win32' || spawnSync('unzip', ['-v'], { stdio: 'ignore' }).status !== 0) {
    t.skip('Unix unzip is unavailable');
    return;
  }
  const { root, archive } = await exportGame(t);
  const file = path.join(root, 'game.zip'), output = path.join(root, 'extracted');
  await writeFile(file, archive.data);
  const extracted = spawnSync('unzip', ['-q', file, '-d', output], { encoding: 'utf8' });
  assert.equal(extracted.status, 0, extracted.stderr);
  const launcher = path.join(output, 'Start-Mac.command');
  assert.equal((await stat(launcher)).mode & 0o777, 0o755);
  assert.match(await readFile(launcher, 'utf8'), /^#!\/bin\/bash\n/);
  assert.equal((await stat(path.join(output, 'index.html'))).mode & 0o111, 0);
});

test('ZIP callers without mode metadata retain their ordinary file attributes and bytes', () => {
  const contents = Buffer.from('plain document');
  const archive = zip([{ name: 'notes.txt', data: contents }]);
  assert.deepEqual(zipAttributes(archive).get('notes.txt'), { host: 0, mode: 0 });
  assert.deepEqual(readProjectZip(archive).get('notes.txt'), contents);
});
