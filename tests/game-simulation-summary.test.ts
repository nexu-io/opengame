import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { GameProjects, GameRuntime } from '../game-projects.ts';

type Observer = 'summarize' | 'viewFor';

function logic(observer: Observer, expression: string, asynchronous = false) {
  const callback = `export ${asynchronous ? 'async ' : ''}function ${observer}(state) { return ${expression}; }`;
  return `
    export const meta = { minPlayers: 1, maxPlayers: 1, serverTick: true };
    export function setup() { return { score: 0 }; }
    export function validateAction() { return false; }
    export function applyAction(state, player, action) { return { score: state.score + (action.type === 'tick' ? 1 : 0) }; }
    export function isGameOver() { return { over: false }; }
    ${observer === 'viewFor' ? callback : 'export function viewFor(state) { return state; }'}
    ${observer === 'summarize' ? callback : ''}
  `;
}

function runtime(source: string) {
  const game = new GameRuntime(source, 'simulation-summary');
  game.setup(['player-1']);
  return game;
}

async function fixture(t: TestContext, source: string) {
  const directory = await mkdtemp(path.join(tmpdir(), 'game-simulation-summary-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const service = new GameProjects(directory, path.join(directory, 'templates'), path.join(directory, 'kits'));
  const { game } = await service.create({ prompt: 'Simulation summary', genre: 'racing', style: 'pixel', setting: 'space', multiplayer: false });
  await service.write(game.id, [{ path: 'logic.js', content: source }]);
  const files = ['game.json', 'logic.js', 'index.html'];
  const snapshot = () => Promise.all(files.map(file => readFile(path.join(service.root, game.id, file), 'utf8')));
  return { service, game, snapshot };
}

for (const observer of ['summarize', 'viewFor'] as const) {
  test(`summary rejects asynchronous ${observer} results`, () => {
    const message = new RegExp(`${observer} must return synchronous JSON`);
    assert.throws(() => runtime(logic(observer, 'state', true)).summary('player-1'), message);
    assert.throws(() => runtime(logic(observer, '({ then(resolve) { resolve(state); } })')).summary('player-1'), message);
  });

  test(`simulation surfaces asynchronous ${observer} without changing game files`, async t => {
    const { service, game, snapshot } = await fixture(t, logic(observer, 'state', true));
    const before = await snapshot();
    await assert.rejects(service.simulate(game.id, { players: 1, scripts: 'idle', maxTicks: 2 }), new RegExp(`${observer} must return synchronous JSON`));
    assert.deepEqual(await snapshot(), before);
  });
}

test('synchronous summaries preserve JSON values through both observer paths', () => {
  for (const observer of ['summarize', 'viewFor'] as const) {
    for (const value of [null, 0, '', [], { then: 'metadata', score: 0 }]) {
      assert.deepEqual(runtime(logic(observer, JSON.stringify(value))).summary('player-1'), value);
    }
    const exactLimit = runtime(logic(observer, "'x'.repeat(32766)")).summary('player-1');
    assert.equal(Buffer.byteLength(JSON.stringify(exactLimit)), 32768);
  }
});

test('custom summaries receive isolated state snapshots', () => {
  const game = runtime(logic('summarize', '(() => { state.score = 99; return state; })()'));
  assert.deepEqual(game.summary('player-1'), { score: 99 });
  assert.deepEqual(game.view('player-1'), { score: 0 });
  game.tick(1);
  assert.deepEqual(game.view('player-1'), { score: 1 });
});

test('summaries still reject undefined, cyclic and oversized JSON', () => {
  for (const observer of ['summarize', 'viewFor'] as const) {
    assert.throws(() => runtime(logic(observer, 'undefined')).summary('player-1'), /under 32 KiB/);
    assert.throws(() => runtime(logic(observer, '(() => { const value = {}; value.self = value; return value; })()')).summary('player-1'), /circular/i);
    assert.throws(() => runtime(logic(observer, "'x'.repeat(32767)")).summary('player-1'), /under 32 KiB/);
  }
});

test('synchronous simulations keep their timeline, determinism and source files', async t => {
  for (const observer of ['summarize', 'viewFor'] as const) {
    const { service, game, snapshot } = await fixture(t, logic(observer, 'state'));
    const before = await snapshot();
    const options = { players: 1, scripts: 'idle' as const, maxTicks: 2 };
    const result = await service.simulate(game.id, options);
    assert.deepEqual(result.timeline, [{ tick: 0, state: { score: 0 } }, { tick: 1, state: { score: 1 } }, { tick: 2, state: { score: 2 } }]);
    assert.deepEqual(await service.simulate(game.id, options), result);
    assert.deepEqual(await snapshot(), before);
  }
});
