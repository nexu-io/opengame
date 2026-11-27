import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { mcpRegistry, rpc } from '../mcp.ts';
import { Phase1Service } from '../phase1.ts';
import { pluginRoot } from '../hyperframes.ts';
import { fixture } from './fixtures.ts';
import { packageOpenGame } from '../scripts/package-opengame.mjs';
import { generateOpenGameInstallGuide } from '../scripts/opengame-install-guide.mjs';
import { extractArchive, runFile, sha256 } from '../scripts/runtime-assets.mjs';
import { offlineGame } from '../scripts/game-template-publication.ts';

const profiles = JSON.parse(await readFile(new URL('../shared/mcp-profiles.json', import.meta.url), 'utf8'));

test('game MCP profile exposes opengame_* and shared openmotion_* tools with isolated resources and aliases', () => fixture(async store => {
  const registry = mcpRegistry('game');
  const expected: string[] = profiles.game.tools;
  assert.equal(expected.length, 20);
  assert.equal(expected.filter(name => name.startsWith('opengame_')).length, 13);
  assert.equal(expected.filter(name => name.startsWith('openmotion_')).length, 7);
  assert(expected.includes('openmotion_media_use'), 'Shipped openmotion-media references call openmotion_media_use');
  assert.deepEqual(registry.tools.map(t => t.name), expected);

  const init: any = await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {} } }, store, registry);
  assert.equal(init.result.serverInfo.name, 'opengame');
  assert.equal(init.result.serverInfo.title, 'OpenGame');
  assert.match(init.result.instructions, /OpenGame/);
  assert.doesNotMatch(init.result.instructions, /openmotion_list_templates/);

  const listed: any = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, store, registry);
  assert.deepEqual(listed.result.tools.map((t: any) => t.name), expected);

  const resources: any = await rpc({ jsonrpc: '2.0', id: 3, method: 'resources/list' }, store, registry);
  assert(resources.result.resources.length > 0);
  assert(resources.result.resources.every((r: any) => /^openmotion:\/\/workflow\/(?:game|media)\//.test(r.uri)));

  const allowedToolSet = new Set(expected);
  for (const resource of resources.result.resources) {
    const readRes: any = await rpc({ jsonrpc: '2.0', id: `res:${resource.uri}`, method: 'resources/read', params: { uri: resource.uri } }, store, registry);
    assert.equal(readRes.error, undefined, `Failed reading ${resource.uri}`);
    const payload = JSON.parse(readRes.result.contents[0].text);
    assert(payload.references.every((ref: any) => ['game', 'media'].includes(ref.workflow)), `Out-of-profile reference in ${resource.uri}`);
    assert.doesNotMatch(payload.readNext, /production\//);
    for (const match of payload.content.matchAll(/\b(?:openmotion|motion|design|opengame)_[a-z_]+\b/g)) {
      assert(allowedToolSet.has(match[0]), `${resource.uri} references unexposed tool ${match[0]}`);
    }
  }

  const gameStart: any = await rpc({ jsonrpc: '2.0', id: 4, method: 'resources/read', params: { uri: 'openmotion://workflow/game/start' } }, store, registry);
  assert.equal(gameStart.error, undefined);
  assert.match(gameStart.result.contents[0].text, /openmotion-game/);
  assert.match(gameStart.result.contents[0].text, /opengame_create/);

  const mediaMaterials: any = await rpc({ jsonrpc: '2.0', id: 41, method: 'resources/read', params: { uri: 'openmotion://workflow/media/materials' } }, store, registry);
  const mediaMaterialsDoc = JSON.parse(mediaMaterials.result.contents[0].text);
  assert.match(mediaMaterialsDoc.content, /openmotion_asset_manage/);
  assert.doesNotMatch(mediaMaterialsDoc.content, /openmotion_(?:get|edit)_project|openmotion_import_assets/);

  const blockedWorkflow: any = await rpc({ jsonrpc: '2.0', id: 5, method: 'resources/read', params: { uri: 'openmotion://workflow/production/start' } }, store, registry);
  assert(blockedWorkflow.error, 'Video-only workflow must be rejected under game profile');

  const blockedTool: any = await rpc({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'openmotion_create_project', arguments: {} } }, store, registry);
  assert.equal(blockedTool.result.isError, true);
  assert.match(blockedTool.result.content[0].text, /MCP_TOOL_NOT_EXPOSED/);

  const service = new Phase1Service(store, pluginRoot, {
    origin: () => 'http://127.0.0.1:4173',
    nativeUrl: () => undefined,
    openProject: async () => {},
    mutation: async task => task(),
    cancel: async () => {},
  });
  const callPhase1 = async (payload: { name: string; arguments: any }) => service.call(payload.name, payload.arguments);

  const byNewName: any = await rpc({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'opengame_get', arguments: { id: offlineGame } } }, store, registry, undefined, undefined, { callPhase1 });
  const byLegacyAlias: any = await rpc({ jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'openmotion_game_get', arguments: { id: offlineGame } } }, store, registry, undefined, undefined, { callPhase1 });
  assert.equal(byNewName.result.isError, undefined);
  assert.equal(byLegacyAlias.result.isError, undefined);
  assert.equal(byNewName.result.structuredContent.id, offlineGame);
  assert.equal(byLegacyAlias.result.structuredContent.id, offlineGame);

  const preview: any = await rpc({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'openmotion_open_preview', arguments: { target: 'game' } } }, store, registry, undefined, undefined, { callPhase1 });
  assert.equal(preview.result.isError, undefined);
  assert.equal(preview.result.structuredContent.target, 'game');
  assert.equal(preview.result.structuredContent.previewUrl, 'http://127.0.0.1:4173/game?embed=1');
  assert.equal(preview.result.structuredContent.projectCreated, false);

  const invalidPreview: any = await rpc({ jsonrpc: '2.0', id: 10, method: 'tools/call', params: { name: 'openmotion_open_preview', arguments: { target: 'game', projectId: 'project' } } }, store, registry, undefined, undefined, { callPhase1 });
  assert.equal(invalidPreview.result.isError, true);

  const mediaInspect: any = await rpc({ jsonrpc: '2.0', id: 11, method: 'tools/call', params: { name: 'openmotion_media_use', arguments: { action: 'inspect' } } }, store, registry, undefined, undefined, { callPhase1 });
  assert.equal(mediaInspect.result.isError, undefined, 'openmotion_media_use inspect must work under game profile');
}, false));

const tinyPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==', 'base64');

async function createGamesFixture(baseDir: string) {
  const gamesDir = path.join(baseDir, 'games-fixture');
  await mkdir(gamesDir, { recursive: true });
  await cp(path.resolve('templates/games', offlineGame), path.join(gamesDir, offlineGame), { recursive: true });
  const lazyDir = path.join(gamesDir, 'sky-dodger');
  await mkdir(path.join(lazyDir, 'assets'), { recursive: true });
  await writeFile(path.join(lazyDir, 'game.json'), JSON.stringify({
    id: 'sky-dodger', title: 'Sky Dodger', description: 'Lazy-downloaded fixture game',
    genre: 'shooter', style: 'pixel', setting: 'space', cover: 'assets/cover.png', status: 'published',
  }, null, 2));
  await writeFile(path.join(lazyDir, 'index.html'), '<!doctype html><title>Sky Dodger</title>');
  await writeFile(path.join(lazyDir, 'assets/cover.png'), tinyPng);
  return gamesDir;
}

test('packageOpenGame produces a trimmed game-profile npm tarball runnable from node_modules and renders concise install.md', { timeout: 180_000 }, async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'opengame-pack-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));

  const gamesRoot = await createGamesFixture(dir);
  const version = '0.1.0-test.1.1';
  const out = path.join(dir, 'build');
  const built = await packageOpenGame(out, version, undefined, { gamesRoot });
  const manifest = JSON.parse(await readFile(built.manifest, 'utf8'));

  assert.equal(built.packageName, 'opengame');
  assert.equal(manifest.product, 'opengame');
  assert.equal(manifest.version, version);
  assert.equal(manifest.templateEnvironment, 'dev');
  assert.equal(manifest.mcp.profile, 'game');
  assert.equal(manifest.mcp.serverName, 'opengame');
  assert.deepEqual(manifest.mcp.tools, profiles.game.tools);
  assert.deepEqual(manifest.skills, ['openmotion-game', 'openmotion-media']);
  assert.equal(manifest.runtime.vision, undefined, 'Python/OpenCV vision runtime must be stripped');
  for (const target of Object.values(manifest.runtime.targets) as any[]) {
    assert.equal(target.vision, undefined);
    assert(target.browser?.sha256, 'Headless Chrome must remain pinned');
  }
  assert.equal(await sha256(built.installer), manifest.installer.sha256);
  assert.equal(await sha256(built.application), manifest.application.sha256);

  // Extract outer npm package into a node_modules path to prove zero TypeScript stripping is needed.
  const fakeNodeModules = path.join(dir, 'node_modules', 'opengame');
  const outerExtract = path.join(dir, 'outer');
  await extractArchive(built.installer, outerExtract);
  await mkdir(path.dirname(fakeNodeModules), { recursive: true });
  await runFile('mv', [path.join(outerExtract, 'package'), fakeNodeModules]);
  const pkgJson = JSON.parse(await readFile(path.join(fakeNodeModules, 'package.json'), 'utf8'));
  assert.equal(pkgJson.name, 'opengame');
  assert.equal(pkgJson.private, false);
  assert.equal(pkgJson.bin.opengame, 'scripts/opengame-launcher.mjs');
  const cliVersion = (await runFile(process.execPath, [path.join(fakeNodeModules, 'scripts/opengame-launcher.mjs'), '--version'])).trim();
  assert.equal(cliVersion, version);
  const cliHelp = await runFile(process.execPath, [path.join(fakeNodeModules, 'scripts/opengame-launcher.mjs'), '--help']);
  assert.match(cliHelp, /opengame setup --host/);
  assert.match(cliHelp, /opengame rollback/);

  // Inspect inner application archive contents.
  const appExtract = path.join(dir, 'app');
  await extractArchive(built.application, appExtract);
  assert.deepEqual(JSON.parse(await readFile(path.join(appExtract, 'shared/mcp-release.json'), 'utf8')), { profile: 'game' });
  assert.equal(existsSync(path.join(appExtract, 'studio/build/index.html')), true, 'Game Studio must stay bundled');
  assert.equal(existsSync(path.join(appExtract, 'templates/games', offlineGame, 'index.html')), true, 'Offline tidebreaker game must stay bundled');
  assert.equal(existsSync(path.join(appExtract, 'templates/game-downloads.json')), true, 'R2 lazy download index must be present');
  assert.equal(existsSync(path.join(appExtract, 'skills/openmotion-game/SKILL.md')), true);
  assert.equal(existsSync(path.join(appExtract, 'skills/openmotion-media/SKILL.md')), true);
  assert.equal(existsSync(path.join(appExtract, 'skills/openmotion-production')), false, 'Video skills must be excluded');
  assert.equal(existsSync(path.join(appExtract, 'template-library')), false, 'Video template library must be excluded');
  assert.equal(existsSync(path.join(appExtract, 'mcp-ui/template-recommendations')), false);
  assert.equal(existsSync(path.join(appExtract, 'library')), false);
  const otherGames = (await readdir(path.join(appExtract, 'templates/games'))).filter(name => name !== offlineGame);
  assert(otherGames.length > 0);
  const sampleOther = otherGames[0];
  assert.equal(existsSync(path.join(appExtract, 'templates/games', sampleOther, 'game.json')), true);
  assert.equal(existsSync(path.join(appExtract, 'templates/games', sampleOther, 'index.html')), false, 'Non-offline game source must stay lazy-downloaded');

  // Render and verify concise Agent install.md.
  const guideDir = path.join(dir, 'guide');
  const record = await generateOpenGameInstallGuide(built.installer, guideDir, true);
  assert.equal(record.packageName, 'opengame');
  assert.equal(record.version, version);
  assert.equal(record.channel, 'test');
  const guideText = await readFile(path.join(guideDir, 'install.md'), 'utf8');
  assert.doesNotMatch(guideText, /\{\{/);
  assert.match(guideText, /<!-- opengame-utm-source-supported -->/);
  assert.match(guideText, /opengame@0\.1\.0-test\.1\.1/);
  assert.match(guideText, /opengame_get\(\{ id: "tidebreaker" \}\)/);
  assert(guideText.split('\n').length <= 60, 'OpenGame install.md should stay concise');

  // Verify --package-name override for scoped fallback naming.
  const scopedOut = path.join(dir, 'scoped');
  const scoped = await packageOpenGame(scopedOut, version, 'dev', { packageName: '@opendesign/game', gamesRoot });
  assert.equal(scoped.packageName, '@opendesign/game');
  const scopedRecord = await generateOpenGameInstallGuide(scoped.installer, path.join(dir, 'scoped-guide'));
  assert.equal(scopedRecord.packageSpec, '@opendesign/game@' + version);
});
