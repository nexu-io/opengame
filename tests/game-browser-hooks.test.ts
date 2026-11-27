import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';
import { GameProjects } from '../game-projects.ts';

// Execute the actual page callbacks against controlled hooks, without installing
// or launching a browser. Screenshots and browser rendering are not tested here.
async function fixture(t: TestContext) {
  const workspace = await mkdtemp(path.join(tmpdir(), 'game-browser-hooks-'));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const service = new GameProjects(workspace, path.join(workspace, 'templates'), path.join(workspace, 'kits'));
  const { game } = await service.create({ prompt: 'Hook deadlines', multiplayer: false, genre: null, style: null, setting: null });
  service.runtimeRoot = path.join(workspace, 'runtime');
  const packageDirectory = path.join(service.runtimeRoot, 'node_modules/puppeteer-core');
  await mkdir(packageDirectory, { recursive: true });
  await writeFile(path.join(packageDirectory, 'package.json'), JSON.stringify({ name: 'puppeteer-core', type: 'module', main: 'index.js' }));
  const moduleFile = path.join(packageDirectory, 'index.js');
  await writeFile(moduleFile, 'export let browser; export function configure(value) { browser = value; } export default { async launch() { return browser; } };');
  const stub = await import(pathToFileURL(moduleFile).href);
  const previous = process.env.MOTION_BROWSER_PATH;
  process.env.MOTION_BROWSER_PATH = process.execPath;
  t.after(() => {
    if (previous === undefined) delete process.env.MOTION_BROWSER_PATH;
    else process.env.MOTION_BROWSER_PATH = previous;
  });

  let tick = 0, closed = 0;
  const hooks = {
    getState: (): unknown => ({ phase: 'playing', tick: ++tick }),
    getStats: (): unknown => ({ score: 0 }),
    start() {},
    sendAction: async (_action: unknown) => {},
    runSelfTests: async () => ({ logic: true }),
  };
  const context = vm.createContext({
    window: { __omGame: hooks, __openmotionGameProbe: { frames: 10, roomJoined: false, playerCount: 1, joinedAtMs: null } },
    innerWidth: 1280, innerHeight: 720,
    document: { documentElement: { scrollWidth: 390 }, body: { scrollWidth: 390 }, querySelector: () => null, querySelectorAll: () => [] },
    requestAnimationFrame: (callback: () => void) => queueMicrotask(callback),
  });
  const element = { style: {}, getAttribute: () => null, setAttribute() {}, removeAttribute() {} };
  const target = {
    evaluate: async (callback: (element: unknown, value?: unknown) => unknown, value?: unknown) => callback(element, value),
    screenshot: async ({ path: filename }: { path: string }) => writeFile(filename, 'controlled screenshot'),
  };
  const page = {
    on() {}, async setRequestInterception() {}, async evaluateOnNewDocument() {}, async goto() {}, async waitForSelector() {},
    async evaluate(callback: string | Function, ...args: unknown[]) {
      context.args = args;
      return vm.runInContext(typeof callback === 'string' ? callback : `(${callback.toString()})(...args)`, context);
    },
    async waitForFunction(callback: string | Function, _options?: unknown, ...args: unknown[]) {
      assert.ok(await this.evaluate(callback, ...args), 'the controlled game must pass startup before testing hooks');
    },
    async $(selector: string) { return selector === 'canvas' ? target : null; },
    async setViewport(size: { width: number; height: number }) { context.innerWidth = size.width; context.innerHeight = size.height; },
  };
  stub.configure({ async createBrowserContext() { return { async newPage() { return page; } }; }, async close() { closed++; } });
  return { service, id: game.id, hooks, closed: () => closed };
}

function deadlines(t: TestContext) {
  const schedule = globalThis.setTimeout, cancel = globalThis.clearTimeout;
  const active = new Map<ReturnType<typeof setTimeout>, () => void>();
  t.mock.method(globalThis, 'setTimeout', (callback: (...args: any[]) => void, ms?: number, ...args: any[]) => {
    const timer = schedule(callback, ms, ...args);
    if (ms === 10000) active.set(timer, () => { active.delete(timer); cancel(timer); callback(...args); });
    return timer;
  });
  t.mock.method(globalThis, 'clearTimeout', (timer: ReturnType<typeof setTimeout> | undefined) => {
    if (timer) active.delete(timer);
    cancel(timer);
  });
  t.after(() => { for (const timer of active.keys()) cancel(timer); t.mock.restoreAll(); });
  return {
    active,
    expire() {
      assert.equal(active.size, 1, 'a pending game hook must have a 10-second application deadline');
      active.values().next().value!();
    },
  };
}

test('pending state hooks produce diagnostics and release the browser run', { timeout: 5000 }, async t => {
  const app = await fixture(t), clock = deadlines(t);
  const reads = [Promise.withResolvers<void>(), Promise.withResolvers<void>()];
  const releases: Array<() => void> = [];
  let stalled = true, count = 0;
  app.hooks.getStats = () => {
    if (!stalled) return { score: 0 };
    reads[count++].resolve();
    return new Promise<void>(resolve => releases.push(resolve));
  };
  const pending = app.service.playtest(app.id, { durationMs: 0, scripts: [[]], waitForReadyMs: 0 });
  try {
    await reads[0].promise;
    clock.expire();
    await reads[1].promise;
    clock.expire();
    const result = await pending;
    assert.match(result.clients[0].authoritative.error, /getState.*getStats.*timed out after 10000ms/);
    assert.equal(app.closed(), 1);
  } finally {
    stalled = false;
    for (const release of releases) release();
    await pending;
  }
  await app.service.playtest(app.id, { durationMs: 0, scripts: [[]], waitForReadyMs: 0 });
  assert.equal(app.closed(), 2);
  assert.equal(clock.active.size, 0);
});

test('a pending action hook becomes an input error and later playtests can run', { timeout: 5000 }, async t => {
  const app = await fixture(t), clock = deadlines(t);
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  app.hooks.sendAction = async () => { entered.resolve(); await release.promise; };
  const pending = app.service.playtest(app.id, { durationMs: 0, scripts: [[{ type: 'action', action: { type: 'move' } }]], waitForReadyMs: 0 });
  try {
    await entered.promise;
    clock.expire();
    const result = await pending;
    assert.ok(result.clients[0].consoleErrors.some(error => /sendAction.*timed out after 10000ms/.test(error)));
    assert.equal(app.closed(), 1);
  } finally {
    release.resolve();
    await pending;
  }
  await app.service.playtest(app.id, { durationMs: 0, scripts: [[]], waitForReadyMs: 0 });
  assert.equal(app.closed(), 2);
  assert.equal(clock.active.size, 0);
});

test('completed asynchronous hooks preserve results and clear their deadline timers', { timeout: 5000 }, async t => {
  const app = await fixture(t), clock = deadlines(t);
  let score = 0;
  app.hooks.getStats = async () => ({ score });
  app.hooks.sendAction = async () => { await Promise.resolve(); score++; };
  const result = await app.service.playtest(app.id, { durationMs: 0, scripts: [[{ type: 'action', action: { type: 'score' } }]], waitForReadyMs: 0 });
  assert.equal(result.clients[0].authoritative.stats.score, 1);
  assert.equal(result.clients[0].selfTests?.logic, true);
  assert.deepEqual(result.clients[0].consoleErrors, []);
  assert.equal(app.closed(), 1);
  assert.equal(clock.active.size, 0, 'completed hooks must not keep a deadline timer alive');
});

test('self-test timeouts and rejections remain failed assertions and clear their timers', { timeout: 5000 }, async t => {
  const app = await fixture(t), clock = deadlines(t);
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  app.hooks.runSelfTests = async () => { entered.resolve(); await release.promise; return { logic: true }; };
  const pending = app.service.playtest(app.id, { durationMs: 0, scripts: [[]], waitForReadyMs: 0 });
  try {
    await entered.promise;
    clock.expire();
    const result = await pending;
    assert.match(result.clients[0].selfTests?.__error, /runSelfTests\(\) timed out after 10000ms/);
    assert.equal(result.clients[0].assertions.find(row => row.name === 'selfTest')?.passed, false);
    assert.equal(clock.active.size, 0);
  } finally {
    release.resolve();
    await pending;
  }
  app.hooks.runSelfTests = async () => { throw new Error('Controlled hook rejection'); };
  const result = await app.service.playtest(app.id, { durationMs: 0, scripts: [[]], waitForReadyMs: 0 });
  assert.match(result.clients[0].selfTests?.__error, /Controlled hook rejection/);
  assert.equal(result.clients[0].assertions.find(row => row.name === 'selfTest')?.passed, false);
  assert.equal(clock.active.size, 0);
});
