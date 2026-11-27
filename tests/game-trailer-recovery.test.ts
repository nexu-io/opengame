import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { GameProjects } from '../game-projects.ts';
import type { GameTrailer } from '../shared/game-contract.ts';

async function fixture() {
  const workspace = await fs.mkdtemp(path.join(tmpdir(), 'game-trailer-recovery-'));
  const service = new GameProjects(workspace, path.join(workspace, 'templates'), path.join(workspace, 'kits'));
  const { game } = await service.create({
    prompt: 'A small space racer', genre: 'racing', style: 'pixel', setting: 'space', multiplayer: false,
  });
  const gameFile = path.join(service.root, game.id, 'game.json');
  const stored = JSON.parse(await fs.readFile(gameFile, 'utf8'));
  await fs.writeFile(gameFile, JSON.stringify({ ...stored, status: 'ready' }));
  const jobFile = path.join(service.root, game.id, 'trailer', 'job.json');
  await fs.mkdir(path.dirname(jobFile), { recursive: true });
  return { workspace, service, id: game.id, jobFile };
}

const interrupted = {
  runId: 'interrupted-run', status: 'rendering', progress: 0.7,
  clips: ['kept-clip.mp4'], projectId: 'kept-project', updatedAt: new Date(0).toISOString(),
};

function recorder(workspace: string, id: string, signal: AbortSignal) {
  const script = 'import { GameProjects } from ' + JSON.stringify(new URL('../game-projects.ts', import.meta.url).href) + ';\n'
    + 'class RecordingProjects extends GameProjects {\n'
    + '  async validate(id) { return { id, passed: true, diagnostics: [] }; }\n'
    + '  async recordTrailer() { return new Promise(() => {}); }\n'
    + '}\n'
    + 'process.on("message", () => {});\n'
    + 'const service = new RecordingProjects(process.argv[1]);\n'
    + 'const job = await service.startTrailer(process.argv[2]);\n'
    + 'process.send({ kind: "started", job });\n';
  const child = spawn(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', script, workspace, id], {
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    env: { ...process.env, OPENMOTION_TELEMETRY: '0', OPENMOTION_AUTO_UPDATE: '0' },
    signal,
  });
  let stderr = '';
  child.stderr?.on('data', bytes => { stderr += String(bytes); });
  const started = new Promise<GameTrailer>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', code => reject(new Error('Trailer worker exited before start: ' + code + '\n' + stderr)));
    child.once('message', message => {
      const result = message as { kind: string; job: GameTrailer };
      if (result.kind !== 'started') reject(new Error('Unexpected trailer worker response'));
      else resolve(result.job);
    });
  });
  return { child, started };
}

async function stop(child: ChildProcess | undefined) {
  if (child && child.exitCode === null && child.signalCode === null) {
    const closed = once(child, 'close');
    child.kill();
    await closed;
  }
}

test('interrupted trailer recovery cannot replace a new recording from another process', { timeout: 30_000 }, async (t: TestContext) => {
  const { workspace, service, id, jobFile } = await fixture();
  const captured = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  const originalRead = fs.readFile;
  let held = false, child: ChildProcess | undefined, reading: Promise<GameTrailer> | undefined;
  try {
    await fs.writeFile(jobFile, JSON.stringify(interrupted));
    const read = t.mock.method(fs, 'readFile', async (...args: Parameters<typeof fs.readFile>) => {
      const bytes = await originalRead(...args);
      if (!held && String(args[0]) === jobFile) {
        held = true;
        captured.resolve();
        await release.promise;
      }
      return bytes;
    });
    syncBuiltinESMExports();
    reading = service.trailer(id);
    await Promise.race([
      captured.promise,
      reading.then(() => { throw new Error('The stale trailer read was not intercepted'); }),
    ]);

    // The reader has real old bytes. A separate owner now completes the public
    // start operation before the stale read resumes; no timing sleeps are used.
    const worker = recorder(workspace, id, t.signal);
    child = worker.child;
    assert.equal((await worker.started).status, 'recording');
    const before = JSON.parse(await originalRead(jobFile, 'utf8'));
    assert.equal(before.ownerPid, child.pid);
    assert.notEqual(before.runId, interrupted.runId);

    release.resolve();
    const recovered = await reading;
    assert.equal(recovered.status, 'recording', 'a stale reader must return the current live recording');
    assert.deepEqual(JSON.parse(await originalRead(jobFile, 'utf8')), before, 'recovery must preserve the new run and owner');
    assert.equal((recovered as unknown as { runId?: string }).runId, undefined);
    assert.equal((recovered as unknown as { ownerPid?: number }).ownerPid, undefined);
    read.mock.restore();
    syncBuiltinESMExports();
  } finally {
    release.resolve();
    await reading?.catch(() => undefined);
    t.mock.restoreAll();
    syncBuiltinESMExports();
    await stop(child);
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

test('interrupted trailer recovery still preserves completed clips and project identity', async () => {
  const { workspace, service, id, jobFile } = await fixture();
  try {
    await fs.writeFile(jobFile, JSON.stringify(interrupted));
    const recovered = await service.trailer(id);
    assert.equal(recovered.status, 'failed');
    assert.match(recovered.error!, /service restart/);
    assert.deepEqual(recovered.clips, interrupted.clips);
    assert.equal(recovered.projectId, interrupted.projectId);
    assert.equal(JSON.parse(await fs.readFile(jobFile, 'utf8')).runId, interrupted.runId);
    assert.deepEqual(await fs.readdir(path.dirname(jobFile)), ['job.json']);
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

test('trailer reads preserve live owners without rewriting their progress', async () => {
  const { workspace, service, id, jobFile } = await fixture();
  try {
    const live = { ...interrupted, runId: 'live-run', ownerPid: process.pid };
    const bytes = JSON.stringify(live);
    await fs.writeFile(jobFile, bytes);
    const result = await service.trailer(id);
    assert.equal(result.status, live.status);
    assert.equal(await fs.readFile(jobFile, 'utf8'), bytes);
    assert.deepEqual(await fs.readdir(path.dirname(jobFile)), ['job.json']);
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});
