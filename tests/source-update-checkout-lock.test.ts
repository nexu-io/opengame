import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import fs, { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test, { type TestContext } from 'node:test';
import { withProcessLock } from '../shared/process-lock.ts';
import { applySourceUpdate, readUpdateState, UPDATE_LOCK_FILENAME, type ExecRunner } from '../shared/source-update.ts';

const previous = '1'.repeat(40), target = '2'.repeat(40);

async function fixture(t: { after: (fn: () => Promise<void>) => void }, fetchHook: () => Promise<void>) {
  const root = await mkdtemp(path.join(tmpdir(), 'opengame-update-lock-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repoRoot = path.join(root, 'checkout');
  await mkdir(path.join(repoRoot, '.git'), { recursive: true });
  await mkdir(path.join(repoRoot, 'studio/build'), { recursive: true });
  await writeFile(path.join(repoRoot, 'studio/build/index.html'), '<html>existing build</html>');
  let head = previous, tracking = previous;
  const exec: ExecRunner = async (file, rawArgs) => {
    assert.equal(file, 'git');
    const args = rawArgs.filter((arg, index) => arg !== '-c' && rawArgs[index - 1] !== '-c');
    let stdout = '';
    switch (args[0]) {
      case 'symbolic-ref': stdout = 'main'; break;
      case 'status': break;
      case 'rev-parse':
        if (args[1] === 'HEAD') stdout = head;
        else if (args[1] === '--verify') stdout = tracking;
        else if (args[1] === '--is-shallow-repository') stdout = 'false';
        else if (args[1] === 'FETCH_HEAD') stdout = target;
        else assert.fail(`Unexpected rev-parse: ${args.join(' ')}`);
        break;
      case 'fetch': await fetchHook(); break;
      case 'merge-base': break;
      case 'diff': stdout = 'game-projects.ts\n'; break;
      case 'reset': head = args[2]; break;
      case 'update-ref': tracking = args[2]; break;
      default: assert.fail(`Unexpected command: ${args.join(' ')}`);
    }
    return { stdout, stderr: '' };
  };
  return {
    lockPath: path.join(repoRoot, '.artifacts', 'install', UPDATE_LOCK_FILENAME),
    dataDirectory: (workspace: string) => path.join(root, workspace),
    update: (workspace: string) => applySourceUpdate({
      repoRoot, dataDirectory: path.join(root, workspace), homeDirectory: path.join(root, 'home'),
      exec, restartBackend: false,
    }),
  };
}

function observeContention(t: TestContext, lockPath: string, blocked: () => void) {
  const link = fs.link;
  t.mock.method(fs, 'link', async (...args: Parameters<typeof fs.link>) => {
    try { return await link(...args); }
    catch (error) {
      if (String(args[1]) === lockPath && (error as NodeJS.ErrnoException).code === 'EEXIST') blocked();
      throw error;
    }
  });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
}

test('different workspaces serialize updates of the same checkout', { timeout: 5000 }, async (t) => {
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  const secondProgress = Promise.withResolvers<'blocked' | 'mutating'>();
  let fetches = 0;
  const app = await fixture(t, async () => {
    if (++fetches === 1) { entered.resolve(); await release.promise; }
    else secondProgress.resolve('mutating');
  });
  observeContention(t, app.lockPath, () => secondProgress.resolve('blocked'));
  const first = app.update('workspace-a');
  await entered.promise;
  const second = app.update('workspace-b');
  let progress: 'blocked' | 'mutating';
  try {
    progress = await secondProgress.promise;
  } finally {
    release.resolve();
  }
  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.equal(progress, 'blocked', 'the second workspace reached mutating Git before joining the checkout lock queue');
  assert.equal(firstResult.status, 'updated');
  assert.equal(secondResult.status, 'up_to_date');
});

test('an acquisition timeout records a structured failure without interrupting the update owner', { timeout: 5000 }, async t => {
  const start = Date.now();
  t.mock.timers.enable({ apis: ['Date'], now: start });
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  const blocked = Promise.withResolvers<void>();
  let fetches = 0;
  const app = await fixture(t, async () => {
    if (++fetches === 1) { entered.resolve(); await release.promise; }
  });
  observeContention(t, app.lockPath, () => blocked.resolve());
  const first = app.update('workspace-a');
  await entered.promise;
  try {
    const second = app.update('workspace-b');
    await blocked.promise;
    t.mock.timers.setTime(start + 240_001);
    const result = await second;
    assert.equal(result.status, 'failed');
    assert.equal(result.updated, false);
    assert.equal(result.reason, 'update_in_progress');
    assert.match(result.error ?? '', /another source update/i);
    const saved = await readUpdateState(app.dataDirectory('workspace-b'));
    assert.equal(saved?.lastStatus, 'failed');
    assert.equal(saved?.lastAttemptAt, start);
    assert.equal(saved?.lastError, result.error);
    assert.equal(fetches, 1, 'a timed-out waiter must not mutate the checkout');
  } finally {
    release.resolve();
    assert.equal((await first).status, 'updated');
  }
  assert.equal((await app.update('workspace-b')).status, 'up_to_date');
});

test('a reclaim timeout records contention and preserves the stale owner until retry', { timeout: 10_000 }, async t => {
  const child = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' });
  const [code, signal] = await once(child, 'exit');
  assert.equal(code, 0);
  assert.equal(signal, null);
  assert.ok(child.pid);
  const start = Date.now();
  t.mock.timers.enable({ apis: ['Date'], now: start });
  let fetches = 0;
  const app = await fixture(t, async () => { fetches++; });
  const reclaim = app.lockPath + '.reclaim';
  const staleOwner = JSON.stringify({ pid: child.pid, token: randomUUID() });
  await mkdir(path.dirname(app.lockPath), { recursive: true });
  await writeFile(app.lockPath, staleOwner);
  const blocked = Promise.withResolvers<void>();
  observeContention(t, reclaim, () => blocked.resolve());
  await withProcessLock(reclaim, async () => {
    const reclaimOwner = await fs.readFile(reclaim, 'utf8');
    const pending = app.update('workspace');
    await blocked.promise;
    t.mock.timers.setTime(start + 240_001);
    const result = await pending;
    assert.equal(result.status, 'failed');
    assert.equal(result.updated, false);
    assert.equal(result.reason, 'update_in_progress');
    const saved = await readUpdateState(app.dataDirectory('workspace'));
    assert.equal(saved?.lastStatus, 'failed');
    assert.equal(saved?.lastAttemptAt, start);
    assert.equal(saved?.lastError, result.error);
    assert.equal(await fs.readFile(app.lockPath, 'utf8'), staleOwner);
    assert.equal(await fs.readFile(reclaim, 'utf8'), reclaimOwner);
    assert.equal(fetches, 0, 'a timed-out reclaimer must not mutate the checkout');
  });
  assert.equal((await app.update('workspace')).status, 'updated');
  assert.equal(fetches, 1);
});

test('separate checkouts can update at the same time', { timeout: 5000 }, async (t) => {
  const bothEntered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  let fetches = 0;
  const onFetch = async () => {
    if (++fetches === 2) bothEntered.resolve();
    await release.promise;
  };
  const firstApp = await fixture(t, onFetch), secondApp = await fixture(t, onFetch);
  const pending = [firstApp.update('workspace'), secondApp.update('workspace')];
  let simultaneous: boolean;
  try {
    simultaneous = await Promise.race([bothEntered.promise.then(() => true), delay(1000, false)]);
  } finally {
    release.resolve();
  }
  const results = await Promise.all(pending);
  assert.equal(simultaneous, true, 'independent checkouts should not share an update lock');
  assert.ok(results.every(result => result.status === 'updated'));
});
