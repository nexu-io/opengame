import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { TriggerService, type TriggerExecutionHost } from '../gateway/triggers.ts';
import type { TriggerRunRecord } from '../shared/triggers.ts';

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

async function fixture(t: TestContext) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'openmotion-trigger-overlap-'));
  const service = new TriggerService(directory);
  t.after(async () => {
    await service.close();
    await rm(directory, { recursive: true, force: true });
  });
  return service;
}

function host(callMcpTool: TriggerExecutionHost['callMcpTool']): TriggerExecutionHost {
  return {
    callMcpTool,
    runAgentOptimization: async () => { throw new Error('Unexpected agent optimization target'); },
    contentBatches: () => { throw new Error('Unexpected content batch target'); },
    runSuperAgentTurn: async () => { throw new Error('Unexpected Super Agent target'); },
  };
}

async function schedule(service: TriggerService, name = 'Scheduled work') {
  return (await service.create({
    name,
    kind: 'schedule',
    intervalSeconds: 60,
    target: { kind: 'mcp-tool', tool: 'openmotion_get_project', arguments: {} },
  })).trigger;
}

for (const firstState of ['completed', 'failed'] as const) {
  test('a ' + firstState + ' run does not unblock a schedule while another run is active', { timeout: 10_000 }, async t => {
    const service = await fixture(t);
    const trigger = await schedule(service);
    const firstStarted = gate(), secondStarted = gate();
    const finishFirst = gate(), finishSecond = gate();
    let calls = 0;
    const execution = host(async () => {
      const call = ++calls;
      if (call === 1) {
        firstStarted.resolve();
        await finishFirst.promise;
        if (firstState === 'failed') throw new Error('First run failed');
      } else if (call === 2) {
        secondStarted.resolve();
        await finishSecond.promise;
      }
      return { ok: true };
    });

    const firstRun = service.fire(trigger.id, {}, execution, 'manual');
    await firstStarted.promise;
    const secondRun = service.fire(trigger.id, {}, execution, 'mcp');
    await secondStarted.promise;
    try {
      assert.equal(calls, 2, 'explicit invocations can still run concurrently');
      finishFirst.resolve();
      assert.equal((await firstRun).run.state, firstState);
      assert.equal((await service.runs(trigger.id)).runs.filter(run => run.state === 'running').length, 1);

      assert.equal(await service.tick(execution, Date.now() + 120_000), 0);
      assert.equal(calls, 2, 'a scheduled invocation must not overlap the remaining run');

      finishSecond.resolve();
      assert.equal((await secondRun).run.state, 'completed');
      assert.equal(await service.tick(execution, Date.now() + 120_000), 1);
      assert.equal(calls, 3, 'the schedule resumes after the final active run finishes');

      const registry = JSON.parse(await readFile(service.registryFile, 'utf8'));
      assert.equal(registry.triggers.find((item: { id: string }) => item.id === trigger.id).runCount, 3);
      const { runs } = await service.runs(trigger.id);
      assert.equal(runs.length, 3);
      assert.equal(runs.filter(run => run.source === 'schedule').length, 1);
      assert.equal(runs.filter(run => run.state === 'running').length, 0);
    } finally {
      finishFirst.resolve();
      finishSecond.resolve();
      await Promise.all([firstRun, secondRun]);
    }
  });
}

test('an active trigger does not block a different due schedule', { timeout: 10_000 }, async t => {
  const service = await fixture(t);
  const active = await schedule(service, 'Active');
  const other = await schedule(service, 'Independent');
  const started = gate(), finish = gate();
  let calls = 0;
  const execution = host(async () => {
    if (++calls === 1) {
      started.resolve();
      await finish.promise;
    }
    return { ok: true };
  });
  const running = service.fire(active.id, {}, execution);
  await started.promise;
  try {
    assert.equal(await service.tick(execution, Date.now() + 120_000), 1);
    assert.equal((await service.get(other.id)).runCount, 1);
    assert.equal((await service.get(active.id)).runCount, 0);
    assert.equal((await service.runs(active.id)).runs[0].state, 'running');
  } finally {
    finish.resolve();
    await running;
  }
});

test('a failed final run releases its schedule for the next tick', async t => {
  const service = await fixture(t);
  const trigger = await schedule(service);
  const failed = await service.fire(trigger.id, {}, host(async () => { throw new Error('Target failed'); }));
  assert.equal(failed.run.state, 'failed');
  assert.equal(await service.tick(host(async () => ({ ok: true })), Date.now() + 120_000), 1);
  assert.equal((await service.get(trigger.id)).runCount, 2);
  const { runs } = await service.runs(trigger.id);
  assert.equal(runs.filter(run => run.state === 'failed').length, 1);
  assert.equal(runs.filter(run => run.state === 'completed').length, 1);
});


for (const source of ['manual', 'mcp'] as const) {
  test('a ' + source + ' run blocks a due schedule while its initial record is being appended', { timeout: 10_000 }, async t => {
    const service = await fixture(t);
    const trigger = await schedule(service);
    const appending = gate(), finishAppend = gate();
    // Defer only the persistence boundary; all registry and run records still use real files.
    const persistence = service as unknown as { appendRun(record: TriggerRunRecord): Promise<void> };
    const appendRun = persistence.appendRun.bind(service);
    let paused = false;
    t.mock.method(persistence, 'appendRun', async (record: TriggerRunRecord) => {
      if (!paused && record.source === source && record.state === 'running') {
        paused = true;
        appending.resolve();
        await finishAppend.promise;
      }
      await appendRun(record);
    });
    let calls = 0;
    const execution = host(async () => { calls++; return { ok: true }; });
    const running = service.fire(trigger.id, {}, execution, source);
    await appending.promise;
    try {
      assert.equal(calls, 0);
      assert.equal(await service.tick(execution, Date.now() + 120_000), 0);
      assert.equal(calls, 0, 'a scheduled target cannot overtake an invocation waiting to be persisted');
      assert.deepEqual((await service.runs(trigger.id)).runs, []);
    } finally {
      finishAppend.resolve();
      await running;
    }
    assert.equal(calls, 1);
    assert.equal(await service.tick(execution, Date.now() + 120_000), 1);
    assert.equal(calls, 2);
    assert.equal((await service.get(trigger.id)).runCount, 2);
    assert.deepEqual((await service.runs(trigger.id)).runs.map(run => run.source).sort(), [source, 'schedule'].sort());
  });
}

test('an initial run append failure releases the schedule without invoking its target', async t => {
  const service = await fixture(t);
  const trigger = await schedule(service);
  let calls = 0;
  const execution = host(async () => { calls++; return { ok: true }; });
  // A directory cannot be replaced by the atomic run-record file.
  await mkdir(service.runsFile);
  try {
    await assert.rejects(service.fire(trigger.id, {}, execution));
    assert.equal(calls, 0);
    assert.equal((await service.get(trigger.id)).runCount, 0);
  } finally {
    await rm(service.runsFile, { recursive: true, force: true });
  }
  assert.equal(await service.tick(execution, Date.now() + 120_000), 1);
  assert.equal(calls, 1);
  assert.equal((await service.get(trigger.id)).runCount, 1);
  assert.equal((await service.runs(trigger.id)).runs[0].state, 'completed');
});
