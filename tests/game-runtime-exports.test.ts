import assert from 'node:assert/strict';
import test from 'node:test';
import { GameRuntime, starterLogic } from '../game-projects.ts';

test('logic modules keep their own bindings separate from runtime bookkeeping', () => {
  const runtime = new GameRuntime('const seed = 42, ctx = {}, state = {}, gameModule = {};\n' + starterLogic, 'binding-test');
  runtime.setup(['player']);
  runtime.apply('player', { type: 'score' });
  assert.deepEqual(runtime.view('player'), { scores: { player: 1 } });
});

test('export aliases can precede declarations and coexist with private names', () => {
  const source = `
    export { limits as meta, initialize as setup, valid as validateAction, update as applyAction, done as isGameOver, view as viewFor };
    const meta = 'private', setup = 'private', seed = 'private';
    const limits = { minPlayers: 1, maxPlayers: 2 };
    const initialize = () => ({ score: 0 });
    const valid = () => true;
    const update = state => ({ score: state.score + 1 });
    const done = () => ({ over: false });
    const view = state => state;
  `;
  const runtime = new GameRuntime(source, 'aliases');
  runtime.setup(['player']);
  runtime.apply('player', {});
  assert.deepEqual(runtime.view('player'), { score: 1 });
});

for (const declaration of ['export { limits as meta }', 'export {}']) {
  for (const expression of ['(function () { limits.tickRate = 30 })()', '[30].forEach(value => { limits.tickRate = value })']) {
    test(`${declaration} preserves the statement boundary before ${expression[0]}`, () => {
      const source = starterLogic.replace(/^export const meta[^\n]*\n/, `
        const limits = { minPlayers: 1, maxPlayers: 1 }
        ${declaration}
        ${expression}
        ${declaration === 'export {}' ? 'export { limits as meta }' : ''}
      `);
      const runtime = new GameRuntime(source, 'export-statement-boundary');
      assert.equal(runtime.meta.tickRate, 30);
      runtime.setup(['player']);
      runtime.apply('player', { type: 'score' });
      assert.deepEqual(runtime.view('player'), { scores: { player: 1 } });
    });
  }
}

test('logic exports retain live bindings and calls remain unbound', () => {
  const source = `
    export { initialize as 'setup' };
    export const meta = { minPlayers: 1, maxPlayers: 1 };
    let initialize = function () { if (this !== undefined) throw Error('Bound callback'); return { score: 0 }; };
    export function validateAction() { return true; }
    export function applyAction(state) { initialize = () => ({ score: 10 }); return state; }
    export function isGameOver() { return { over: false }; }
    export function viewFor(state) { return state; }
    export function referenceRoute() { return []; }
    export function summarize(state) { return { score: state.score }; }
  `;
  const runtime = new GameRuntime(source, 'live-exports');
  runtime.setup(['player']);
  runtime.apply('player', {});
  runtime.setup(['player']);
  assert.deepEqual(runtime.summary('player'), { score: 10 });
  assert.deepEqual(runtime.referenceRoute(0), []);
});

test('destructured variable exports provide the same logic contract', () => {
  const source = `
    export const { meta } = { meta: { minPlayers: 1, maxPlayers: 1 } };
    export const [setup, validateAction, applyAction, isGameOver, viewFor] = [
      () => ({ score: 2 }), () => true, state => state, () => ({ over: false }), state => state,
    ];
  `;
  const runtime = new GameRuntime(source, 'destructured-exports');
  runtime.setup(['player']);
  assert.deepEqual(runtime.view('player'), { score: 2 });
  assert.deepEqual(runtime.over(), { over: false });
});

test('module binding isolation preserves deterministic inputs and code-generation restrictions', () => {
  for (const code of ['Math.random();', 'Date.now();', 'require("fs");', 'import("fs");']) {
    assert.throws(() => new GameRuntime(starterLogic + '\n' + code, 'restricted'), /cannot import\/require/);
  }
  assert.throws(() => new GameRuntime(starterLogic + '\nFunction("return process")();', 'restricted'), /Code generation/);
  const source = starterLogic.replace('[id, 0]', '[id, ctx.random()]');
  const first = new GameRuntime(source, 'same-seed'), second = new GameRuntime(source, 'same-seed');
  first.setup(['player']); second.setup(['player']);
  assert.deepEqual(first.view('player'), second.view('player'));
});
