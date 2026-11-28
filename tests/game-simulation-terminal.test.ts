import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { GameProjects } from '../game-projects.ts';

async function fixture(t: TestContext, initial: 'running' | 'win' | 'loss', endTick = 3) {
  const workspace = await mkdtemp(path.join(tmpdir(), 'game-simulation-terminal-'));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const service = new GameProjects(workspace, path.join(workspace, 'templates'), path.join(workspace, 'kits'));
  const { game } = await service.create({ prompt: 'Terminal simulation', genre: 'racing', multiplayer: true });
  await writeFile(path.join(service.root, game.id, 'logic.js'), `
    export const meta = { minPlayers: 1, maxPlayers: 1, tickRate: 20, serverTick: true };
    export function setup(ctx, players) { return { tick: 0, inputs: 0, result: ${JSON.stringify(initial)}, players }; }
    export function validateAction(state, player, action) { return action.type === 'score'; }
    export function applyAction(state, player, action) {
      if (state.result !== 'running') throw Error('A terminal game must not receive another action');
      if (action.type === 'tick') {
        state.tick++;
        if (state.tick === ${endTick}) state.result = 'win';
      } else if (action.type === 'score') state.inputs++;
      return state;
    }
    export function isGameOver(state) { return { over: state.result !== 'running', winners: state.result === 'win' ? state.players : [] }; }
    export function viewFor(state) { return state; }
  `);
  return { service, id: game.id };
}

for (const initial of ['win', 'loss'] as const) {
  test(`simulation reports an initial ${initial} at tick zero without applying input`, async t => {
    const { service, id } = await fixture(t, initial);
    const result = await service.simulate(id, {
      players: 1, maxTicks: 100,
      scripts: [[{ fromTick: 1, toTick: 2, action: { type: 'score' } }]],
    });
    assert.deepEqual(result.result, { over: true, winners: initial === 'win' ? ['player-1'] : [], tick: 0 });
    assert.equal(result.timeline.length, 1);
    assert.equal(result.timeline[0].tick, 0);
    assert.deepEqual(result.timeline[0].state, { tick: 0, inputs: 0, result: initial, players: ['player-1'] });
  });
}

test('simulation still stops on the first terminal tick after validated inputs', async t => {
  const { service, id } = await fixture(t, 'running');
  const result = await service.simulate(id, {
    players: 1, maxTicks: 100,
    scripts: [[{ fromTick: 1, toTick: 2, action: { type: 'score' } }]],
  });
  assert.deepEqual(result.result, { over: true, winners: ['player-1'], tick: 3 });
  assert.equal(result.timeline[0].tick, 0);
  assert.equal(result.timeline.at(-1)?.tick, 3);
  assert.deepEqual(result.timeline.at(-1)?.state, { tick: 3, inputs: 2, result: 'win', players: ['player-1'] });
});

test('a nonterminal simulation executes exactly the requested tick budget', async t => {
  const { service, id } = await fixture(t, 'running', 100);
  const result = await service.simulate(id, { players: 1, maxTicks: 4, scripts: 'idle' });
  assert.deepEqual(result.result, { over: false, winners: [], tick: 4 });
  assert.deepEqual(result.timeline.at(-1)?.state, { tick: 4, inputs: 0, result: 'running', players: ['player-1'] });
});

test('terminal initial state does not bypass simulation request validation', async t => {
  const { service, id } = await fixture(t, 'win');
  await assert.rejects(service.simulate(id, { players: 1, maxTicks: 0, scripts: 'idle' }), /maxTicks/);
  await assert.rejects(service.simulate(id, { players: 1, maxTicks: 10, scripts: [] }), /one simulation route per player/);
  await assert.rejects(service.simulate(id, { players: 1, maxTicks: 10, scripts: [[{ fromTick: 2, toTick: 1, action: {} }]] }), /Route ticks must be inclusive integers/);
});
