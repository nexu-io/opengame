import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { attributeGuide } from '../workers/install-guide/index.ts';

const guide = '<!-- openmotion-utm-source-supported -->\n`openmotion setup --host codex`\n`openmotion setup --host deepseek --profile PROFILE`\n`openmotion prepare`';

test('install Worker keeps direct guides unchanged and annotates only supported setup commands', async () => {
  assert.equal(attributeGuide(guide, null), guide);
  assert.equal(attributeGuide(guide, '$(bad)'), guide);
  assert.equal(attributeGuide('openmotion setup --host codex', 'producthunt'), 'openmotion setup --host codex');
  const env = { RELEASES: { async get(key: string) {
    assert.equal(key, 'open-motion/dev/install.md');
    return { body: new Response(guide).body!, text: async () => guide, writeHttpMetadata() {} };
  } } };
  const direct = await worker.fetch(new Request('https://releases.open-design.ai/open-motion/dev/install.md'), env);
  const attributed = await worker.fetch(new Request('https://releases.open-design.ai/open-motion/dev/install.md?utm_source=producthunt'), env);
  assert.equal(direct.headers.get('cache-control'), 'no-store');
  assert.equal(attributed.headers.get('cache-control'), 'no-store');
  assert.equal(await direct.text(), guide);
  const text = await attributed.text();
  assert.match(text, /setup --host codex --utm-source producthunt/);
  assert.match(text, /setup --host deepseek --utm-source producthunt --profile PROFILE/);
  assert.match(text, /`openmotion prepare`/);
});

test('install Worker maps public guide hosts to their stable and test objects', async () => {
  const testHost = 'open-design' + '.powerformer.net';
  const requested: string[] = [];
  const env = { RELEASES: { async get(key: string) {
    requested.push(key);
    return { body: new Response(guide).body!, text: async () => guide, writeHttpMetadata() {} };
  } } };
  const stable = await worker.fetch(new Request('https://open-design.ai/motion/install.md'), env);
  const testGuide = await worker.fetch(new Request(`https://${testHost}/motion/install.md`), env);
  const unknown = await worker.fetch(new Request('https://unknown.example/motion/install.md'), env);
  assert.equal(stable.status, 200);
  assert.equal(testGuide.status, 200);
  assert.equal(unknown.status, 404);
  assert.deepEqual(requested, ['open-motion/install.md', 'open-motion/dev/install.md']);
});

test('install Worker routes OpenGame guide paths and attributes opengame setup commands', async () => {
  const gameGuide = '<!-- opengame-utm-source-supported -->\n`npx --yes --package "opengame@0.1.0" opengame setup --host codex`\n`npx --yes --package "opengame@0.1.0" opengame setup --host deepseek --profile PROFILE`\n`opengame prepare`';
  assert.equal(attributeGuide(gameGuide, null), gameGuide);
  assert.equal(attributeGuide('opengame setup --host codex', 'producthunt'), 'opengame setup --host codex');
  const testHost = 'open-design' + '.powerformer.net';
  const requested: string[] = [];
  const env = { RELEASES: { async get(key: string) {
    requested.push(key);
    return { body: new Response(gameGuide).body!, text: async () => gameGuide, writeHttpMetadata() {} };
  } } };
  const shortRoute = await worker.fetch(new Request('https://releases.open-design.ai/game?utm_source=launch'), env);
  const directStable = await worker.fetch(new Request('https://releases.open-design.ai/open-game/install.md'), env);
  const directDev = await worker.fetch(new Request('https://releases.open-design.ai/open-game/dev/install.md'), env);
  const domainStable = await worker.fetch(new Request('https://open-design.ai/game/install.md'), env);
  const domainDev = await worker.fetch(new Request(`https://${testHost}/game/install.md`), env);
  for (const res of [shortRoute, directStable, directDev, domainStable, domainDev]) assert.equal(res.status, 200);
  assert.deepEqual(requested, [
    'open-game/install.md',
    'open-game/install.md',
    'open-game/dev/install.md',
    'open-game/install.md',
    'open-game/dev/install.md',
  ]);
  const text = await shortRoute.text();
  assert.match(text, /opengame setup --host codex --utm-source launch/);
  assert.match(text, /opengame setup --host deepseek --utm-source launch --profile PROFILE/);
  assert.match(text, /`opengame prepare`/);
});
