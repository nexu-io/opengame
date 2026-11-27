import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { GameProjects } from '../game-projects.ts';

const entry = '<canvas id="game"></canvas>';

async function fixture(t: TestContext, minPlayers: number, maxPlayers: number, expectedPlayers: number, multiplayer = true) {
  const workspace = await mkdtemp(path.join(tmpdir(), 'game-validation-players-'));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const service = new GameProjects(workspace, path.join(workspace, 'templates'), path.join(workspace, 'kits'));
  // This fixture has no HTML dependencies. Keep the player/VM regression
  // independent of the separately installed HTML parser runtime.
  service.runtimeRoot = path.join(workspace, 'runtime');
  const packages = path.join(service.runtimeRoot, 'node_modules');
  await mkdir(path.join(packages, '@hyperframes/parsers'), { recursive: true });
  await mkdir(path.join(packages, 'linkedom'), { recursive: true });
  await writeFile(path.join(packages, '@hyperframes/parsers/package.json'), '{"name":"@hyperframes/parsers"}');
  await writeFile(path.join(packages, 'linkedom/package.json'), '{"name":"linkedom","main":"index.cjs"}');
  await writeFile(path.join(packages, 'linkedom/index.cjs'), `
    exports.parseHTML = source => {
      if (source !== ${JSON.stringify(entry)}) throw Error('Unexpected HTML fixture');
      return { document: { querySelector: () => null, querySelectorAll: () => [] } };
    };
  `);
  const { game } = await service.create({ prompt: 'Player limits', multiplayer, genre: 'racing', style: null, setting: null });
  const source = `
    export const meta = { minPlayers: ${minPlayers}, maxPlayers: ${maxPlayers}, tickRate: 20 };
    export function setup(ctx, players) {
      if (players.length < meta.minPlayers || players.length > meta.maxPlayers) throw Error('Invalid setup player count: ' + players.length);
      if (players.length !== ${expectedPlayers}) throw Error('Unexpected smoke-test player count: ' + players.length);
      return { players };
    }
    export function validateAction() { return true; }
    export function applyAction(value) { return value; }
    export function viewFor(value, player) {
      if (!value.players.includes(player)) throw Error('Unknown view player');
      return value;
    }
    export function isGameOver() { return { over: false }; }
  `;
  await service.write(game.id, [
    { path: 'index.html', content: entry },
    { path: 'client.js', content: 'const room = new URLSearchParams(location.search).get("room");' },
    { path: 'logic.js', content: source },
  ]);
  return { service, id: game.id, source };
}

for (const [minPlayers, maxPlayers, expectedPlayers] of [[3, 4, 3], [4, 4, 4], [1, 1, 1], [1, 4, 2]]) {
  test(`validation and publication honor multiplayer limits ${minPlayers}–${maxPlayers}`, async t => {
    const { service, id } = await fixture(t, minPlayers, maxPlayers, expectedPlayers);
    const result = await service.validate(id);
    assert.deepEqual(result.diagnostics, []);
    assert.equal(result.passed, true);
    const published = await service.publish(id);
    assert.equal(published.game.status, 'published');
    assert.equal(published.game.maxPlayers, maxPlayers);
  });
}

test('honoring player limits does not hide genuine setup errors', async t => {
  const { service, id, source } = await fixture(t, 1, 4, 2);
  await service.write(id, [{ path: 'logic.js', content: source.replace('return { players };', "throw Error('Broken setup invariant');") }]);
  const result = await service.validate(id);
  assert.equal(result.passed, false);
  assert.ok(result.diagnostics.some(row => row.path === 'logic.js' && row.message === 'Broken setup invariant'));
  await assert.rejects(service.publish(id), /Broken setup invariant/);
});

test('single-player validation retains its minimum-player setup', async t => {
  const { service, id } = await fixture(t, 1, 4, 1, false);
  assert.deepEqual((await service.validate(id)).diagnostics, []);
  assert.equal((await service.publish(id)).game.status, 'published');
});
