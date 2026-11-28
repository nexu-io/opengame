import assert from 'node:assert/strict';
import test from 'node:test';
import { GameRuntime, starterLogic } from '../game-projects.ts';

for (const event of ['tick', 'membership'] as const) {
  for (const [name, result, error] of [
    ['undefined', 'return undefined;', /applyAction must return synchronous state/],
    ['promise', 'return Promise.resolve(state);', /applyAction must return synchronous state/],
    ['cyclic', 'const next = {}; next.self = next; return next;', /circular/i],
  ] as const) {
    test(`${event} rejects an invalid ${name} state from applyAction`, () => {
      const source = starterLogic.replace(/^export function applyAction[^\n]*$/m,
        `export function applyAction(state, playerId, action) { if (action.type === '${event}') { ${result} } return state; }`);
      const runtime = new GameRuntime(source, 'synchronous-state');
      runtime.setup(['player']);
      assert.throws(() => event === 'tick' ? runtime.tick(1) : runtime.membership('guest', true), error);
    });
  }
}

for (const callback of ['setup', 'applyAction'] as const) {
  for (const [name, result] of [
    ['undefined', 'return undefined;'],
    ['promise', 'return Promise.resolve({});'],
    ['cyclic', 'const next = {}; next.self = next; return next;'],
  ] as const) {
    test(`${callback} retains its ${name} state check`, () => {
      const source = starterLogic.replace(new RegExp(`^export function ${callback}[^\\n]*$`, 'm'),
        `export function ${callback}() { ${result} }`);
      const runtime = new GameRuntime(source, 'shared-state-check');
      if (callback !== 'setup') runtime.setup(['player']);
      assert.throws(() => callback === 'setup' ? runtime.setup(['player']) : runtime.apply('player', { type: 'score' }),
        name === 'cyclic' ? /circular/i : new RegExp(`${callback} must return synchronous state`));
    });
  }
}

test('ordinary server ticks and membership updates still produce the expected state', () => {
  const runtime = new GameRuntime(starterLogic, 'valid-state');
  runtime.setup(['player']);
  runtime.tick(1);
  runtime.membership('guest', true);
  runtime.apply('guest', { type: 'score' });
  assert.deepEqual(runtime.view('player'), { scores: { player: 0, guest: 1 } });
  runtime.membership('guest', false, true);
  assert.deepEqual(runtime.view('player'), { scores: { player: 0 } });
});
