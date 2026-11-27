import assert from 'node:assert/strict';
import test from 'node:test';
import { GameRuntime } from '../game-projects.ts';

type ResultMethod = 'view' | 'referenceRoute' | 'summary';
function runtime(method: ResultMethod, expression: string) {
  const game = new GameRuntime(`
    export const meta = { minPlayers: 1, maxPlayers: 1, tickRate: 20 };
    export function setup() { return { score: 0 }; }
    export function validateAction() { return false; }
    export function applyAction(state) { return state; }
    export function isGameOver() { return { over: false }; }
    export function viewFor(state) { return ${method === 'view' ? expression : 'state'}; }
    export function referenceRoute() { return ${method === 'referenceRoute' ? expression : '[]'}; }
    export function summarize(state) { return ${method === 'summary' ? expression : 'state'}; }
  `, 'json-byte-limits');
  game.setup(['player-1']);
  return game;
}
function result(game: GameRuntime, method: ResultMethod): unknown {
  return method === 'referenceRoute' ? game.referenceRoute(0) : game[method]('player-1');
}

for (const [method, limit] of [['view', 1024 * 1024], ['referenceRoute', 1024 * 1024], ['summary', 32768]] as const) {
  test(`${method} rejects JSON whose UTF-8 bytes exceed the limit despite fewer string code units`, () => {
    const count = Math.ceil(limit / 3);
    const expression = method === 'referenceRoute'
      ? `[{ fromTick: 1, toTick: 1, action: { message: '世'.repeat(${count}) } }]`
      : `'世'.repeat(${count})`;
    const payload = method === 'referenceRoute'
      ? [{ fromTick: 1, toTick: 1, action: { message: '世'.repeat(count) } }]
      : '世'.repeat(count);
    const serialized = JSON.stringify(payload);
    assert.ok(serialized.length < limit);
    assert.ok(Buffer.byteLength(serialized) > limit);
    assert.throws(() => result(runtime(method, expression), method), method === 'summary' ? /under 32 KiB/ : /under 1 MiB/);
  });

  test(`${method} preserves the exact byte limit for Unicode and ASCII payloads`, () => {
    // Keep a usable scripted action in the route, including its JSON overhead.
    const wrap = (value: string) => method === 'referenceRoute'
      ? `[{ fromTick: 1, toTick: 1, action: { message: ${value} } }]`
      : value;
    const wrapperBytes = Buffer.byteLength(JSON.stringify(method === 'referenceRoute'
      ? [{ fromTick: 1, toTick: 1, action: { message: '' } }]
      : ''));
    const unicodeCount = Math.floor((limit - wrapperBytes) / 3);
    const asciiCount = limit - wrapperBytes - unicodeCount * 3;
    const value = `'世'.repeat(${unicodeCount}) + 'a'.repeat(${asciiCount})`;
    const expression = wrap(value);
    const accepted = result(runtime(method, expression), method);
    assert.equal(Buffer.byteLength(JSON.stringify(accepted)), limit);
    const ascii = `'a'.repeat(${limit - wrapperBytes})`;
    assert.equal(Buffer.byteLength(JSON.stringify(result(runtime(method, wrap(ascii)), method))), limit);
  });
}

test('JSON escaping still counts toward the output byte limit', () => {
  // Newlines serialize to two ASCII bytes each, not one character.
  const expression = "'\\n'.repeat(16384)";
  assert.throws(() => runtime('summary', expression).summary('player-1'), /under 32 KiB/);
});
