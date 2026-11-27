import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { deflateSync } from 'node:zlib';
import { browserExecutable } from '../browser.ts';
import { GameProjects, buildPlaytestContactSheet, gamePlaytestAssertions, inspect3dKinematicsWarnings, normalizeKinematicsAssertions, normalizeSelfTestAssertions, validateGameScript } from '../game-projects.ts';
import { AssetLibrary } from '../gateway/asset-library.ts';
import { assetOperation } from '../gateway/asset-operations.ts';
import { readLibraryAsset } from '../gateway/asset-read.ts';
import { optimizeGlbTexturesForPublish } from '../gateway/glb-optimize.ts';
import { buildPublishBundle } from '../gateway/web-publish-bundle.ts';
import { inspectGlb } from '../scripts/game-glb-inspect.mjs';
import { WorkspaceStore } from '../workspace.ts';

const execFileAsync = promisify(execFile);

/** Pure-Node RGB PNG generator for deterministic GLB/WebP compression tests. */
function makeSyntheticPng(width: number, height: number): Buffer {
  const crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    crcTable[n] = c >>> 0;
  }
  const crc32 = (buf: Buffer) => {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, 'ascii');
    data.copy(out, 8);
    out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB opaque
  const stride = 1 + width * 3;
  const raw = Buffer.alloc(stride * height);
  let seed = 1337;
  for (let y = 0; y < height; y++) {
    const row = y * stride;
    raw[row] = 0;
    for (let x = 0; x < width; x++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const noise = (seed >>> 24) & 0x3f;
      const idx = row + 1 + x * 3;
      raw[idx] = Math.min(255, ((x * 255) / width) | 0 ^ noise);
      raw[idx + 1] = Math.min(255, ((y * 255) / height) | 0 ^ (noise >> 1));
      raw[idx + 2] = Math.min(255, (((x + y) * 127) / (width + height)) | 0 ^ noise);
    }
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 1 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Builds a valid 1-triangle GLB 2 binary with an embedded PNG texture and optional BLEND material. */
function makeSyntheticGlb(pngBytes: Buffer, options: { blendMaterial?: boolean } = {}): Buffer {
  // 3 vertices (VEC3 float32 = 36 bytes) forming a triangle resting at y = 0..2.
  const pos = Buffer.alloc(36);
  const verts = [0, 0, 0, 1.5, 0, 0, 0.75, 2.0, 0.5];
  verts.forEach((v, i) => pos.writeFloatLE(v, i * 4));
  const imgPad = (4 - (pngBytes.length % 4)) % 4;
  const bin = Buffer.concat([pos, pngBytes, Buffer.alloc(imgPad)]);

  const doc = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name: 'HeroRoot', mesh: 0, rotation: [0, 1, 0, 0] }],
    buffers: [{ byteLength: bin.length }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: pos.length },
      { buffer: 0, byteOffset: pos.length, byteLength: pngBytes.length },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1.5, 2.0, 0.5] },
    ],
    images: [{ name: 'albedo', mimeType: 'image/png', bufferView: 1 }],
    textures: [{ source: 0 }],
    materials: [
      {
        name: 'BodyMat',
        pbrMetallicRoughness: { baseColorTexture: { index: 0 } },
        ...(options.blendMaterial ? { alphaMode: 'BLEND' } : {}),
      },
    ],
    meshes: [{ name: 'HeroMesh', primitives: [{ attributes: { POSITION: 0 }, material: 0 }] }],
  };
  const jsonRaw = Buffer.from(JSON.stringify(doc), 'utf8');
  const jsonPad = (4 - (jsonRaw.length % 4)) % 4;
  const jsonChunk = Buffer.concat([jsonRaw, Buffer.alloc(jsonPad, 0x20)]);
  const total = 12 + 8 + jsonChunk.length + 8 + bin.length;
  const header = Buffer.alloc(12);
  header.write('glTF', 0, 'ascii');
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(total, 8);
  const jh = Buffer.alloc(8);
  jh.writeUInt32LE(jsonChunk.length, 0);
  jh.writeUInt32LE(0x4e4f534a, 4);
  const bh = Buffer.alloc(8);
  bh.writeUInt32LE(bin.length, 0);
  bh.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, jh, jsonChunk, bh, bin]);
}

async function withWorkspace(fn: (workspace: string, service: GameProjects) => Promise<void>) {
  const workspace = await mkdtemp(path.join(tmpdir(), 'opengame-generalized-'));
  try {
    const service = new GameProjects(workspace, path.join(workspace, 'templates'), path.resolve('templates/game-kits'));
    await fn(workspace, service);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

test('H3: game-glb-inspect reports bounds, texture ratio, alphaMode BLEND, root transforms and advisories', async () => {
  const png = makeSyntheticPng(384, 384);
  const glb = makeSyntheticGlb(png, { blendMaterial: true });
  const info = inspectGlb(glb);
  assert.equal(info.triangleCount, 1);
  assert.equal(info.totalBytes, glb.length);
  assert.deepEqual(info.bounds, { min: [0, 0, 0], max: [1.5, 2, 0.5], size: [1.5, 2, 0.5], minY: 0 });
  assert.equal(info.images.length, 1);
  assert.equal(info.images[0].mimeType, 'image/png');
  assert.equal(info.images[0].bytes, png.length);
  assert.ok(info.textureRatio > 0.8);
  assert.deepEqual(info.materials.blendMaterials, ['BodyMat']);
  assert.equal(info.rootTransforms?.length, 1);
  assert.ok(info.advisories?.some((a: string) => /alphaMode=BLEND/.test(a)));
  assert.ok(info.advisories?.some((a: string) => /EXT_texture_webp/.test(a)));

  // Existing bundled KayKit models keep full compatibility plus new diagnostics.
  const knight = inspectGlb(await readFile(path.resolve('templates/game-kits/characters/Knight.glb')));
  assert.equal(knight.triangleCount, 6952);
  assert.equal(knight.boneCount, 41);
  assert.ok(knight.bounds && knight.bounds.size[1] > 1);
  assert.equal(knight.totalBytes > 100000, true);
});

test('H1: adaptive validation supports modular solo ESM games without logic.js and catches broken local imports', () =>
  withWorkspace(async (_workspace, service) => {
    const { game } = await service.create({
      prompt: 'Open island 3D sandbox exploration',
      genre: 'casual',
      style: '3d',
      setting: 'fantasy',
      multiplayer: false,
    });
    // Replace entry with modular ESM under src/ without importing logic.js.
    await service.write(game.id, [
      {
        path: 'index.html',
        content: '<!doctype html><canvas id="game"></canvas><script type="module" src="./src/main.js"></script>',
      },
      {
        path: 'src/main.js',
        content: 'import { WORLD_SIZE } from "./world.js"; window.__omGame = { getState: () => ({ selfId: "p1", players: { p1: { connected: true, x: 0, z: 0 } }, phase: "explore", worldSize: WORLD_SIZE }) };',
      },
      {
        path: 'src/world.js',
        content: 'export const WORLD_SIZE = 120;',
      },
    ]);
    // Untouched starter logic.js on disk is ignored (no false starter warning), and deleting logic.js also passes.
    const validWithUnusedStarter = await service.validate(game.id);
    assert.equal(validWithUnusedStarter.passed, true, JSON.stringify(validWithUnusedStarter));
    assert.equal(validWithUnusedStarter.warnings.some(w => /starter kit/.test(w)), false);

    await rm(path.join(service.root, game.id, 'logic.js'));
    const validWithoutLogic = await service.validate(game.id);
    assert.equal(validWithoutLogic.passed, true, JSON.stringify(validWithoutLogic));

    // Calling simulate on a game without logic.js gives clear guidance.
    await assert.rejects(
      service.simulate(game.id, { players: 1, scripts: 'idle', maxTicks: 100 }),
      /openmotion_game_playtest.*runSelfTests/,
    );

    // Missing relative import or disallowed host inside src/world.js is caught by validate.
    await service.write(game.id, [
      { path: 'src/world.js', content: 'import "./missing.js"; fetch("https://evil.example/a"); export const WORLD_SIZE = 120;' },
    ]);
    const broken = await service.validate(game.id);
    assert.equal(broken.passed, false);
    assert.ok(broken.diagnostics.some(d => d.path === 'src/world.js' && /missing\.js/.test(d.message)));
    assert.ok(broken.diagnostics.some(d => d.path === 'src/world.js' && /evil\.example/.test(d.message)));
  }));

test('H1: inline script syntax blocks publication while inert script data remains valid', () =>
  withWorkspace(async (_workspace, service) => {
    const { game } = await service.create({ prompt: 'Inline game', multiplayer: false });
    await service.write(game.id, [{ path: 'index.html', content: '<canvas></canvas><script>const score = ;</script>' }]);
    const broken = await service.validate(game.id);
    assert.equal(broken.passed, false);
    assert.ok(broken.diagnostics.some(row => row.path === 'index.html' && /JavaScript syntax error/.test(row.message)));
    await assert.rejects(service.publish(game.id), /Game validation failed/);

    await service.write(game.id, [{ path: 'index.html', content: [
      '<canvas></canvas>',
      '<script type="application/json">{"label":"Game data"}</script>',
      '<template><script>const invalid = ;</script></template>',
      '<noscript><script>const invalid = ;</script></noscript>',
      '<script nomodule>const invalid = ;</script>',
      '<script>with ({ score: 1 }) { score; }</script>',
      '<script type="module">await Promise.resolve(); export const score = 1;</script>',
    ].join('') }]);
    assert.deepEqual((await service.validate(game.id)).diagnostics, []);
    assert.equal((await service.publish(game.id)).game.status, 'published');
  }));

test('H2: validateGameScript supports screenshot & action inputs and gamePlaytestAssertions flattens runSelfTests & sandbox phases', () => {
  const script = validateGameScript([
    { type: 'screenshot', label: 'entry_ready' },
    { type: 'action', action: { type: 'setCamera', view: 'back' } },
    { type: 'key', key: 'w', event: 'down' },
    { type: 'wait', ms: 200 },
    { type: 'key', key: 'w', event: 'up' },
    { type: 'screenshot', label: 'after_move' },
  ]);
  assert.equal(script.length, 6);
  assert.throws(() => validateGameScript([{ type: 'screenshot', label: '../bad' }]), /Screenshot labels/);
  assert.throws(() => validateGameScript([{ type: 'action', action: null as any }]), /JSON object/);
  assert.throws(() => validateGameScript([{ type: 'action', action: [] as any }]), /JSON object/);
  assert.throws(
    () => validateGameScript([{ type: 'action', action: { blob: 'x'.repeat(17000) } }]),
    /at most 16 KiB/,
  );
  assert.throws(
    () => validateGameScript(Array.from({ length: 9 }, (_, i) => ({ type: 'screenshot', label: `s${i}` }))),
    /at most 8 screenshot/,
  );

  const normalized = normalizeSelfTestAssertions({
    wallCollision: { pass: true, detail: 'blocked cleanly' },
    coverUnmount: { pass: false, detail: 'overlay still in DOM' },
  });
  assert.equal(normalized.length, 2);
  assert.equal(normalized[0].name, 'selfTest:wallCollision');
  assert.equal(normalized[0].passed, true);
  assert.equal(normalized[1].name, 'selfTest:coverUnmount');
  assert.equal(normalized[1].passed, false);
  assert.equal(normalized[1].reason, 'overlay still in DOM');

  const assertions = gamePlaytestAssertions({
    before: { state: { selfId: 'p1', players: { p1: { x: 0, z: 0 } } } },
    after: { state: { selfId: 'p1', phase: 'explore', players: { p1: { connected: true, x: 3, z: 0 } } } },
    clients: 1,
    script,
    mobile: { width: 390, height: 844, scrollWidth: 390, overflowElements: [] },
    selfTests: { physicsFinite: { pass: true } },
  });
  assert.equal(assertions.find(a => a.name === 'phase')?.passed, true);
  assert.equal(assertions.find(a => a.name === 'selfTest:physicsFinite')?.passed, true);
});

test('H2 (live headless): playtest waits for phase loading->ready, captures mid-script screenshots and runs __omGame.runSelfTests()', async t => {
  if (!await browserExecutable().catch(() => undefined)) {
    t.skip('Local Chrome unavailable');
    return;
  }
  await withWorkspace(async (_workspace, service) => {
    const { game } = await service.create({
      prompt: 'Async loading 3D sandbox test',
      genre: 'casual',
      style: '3d',
      setting: null,
      multiplayer: false,
    });
    await service.write(game.id, [
      {
        path: 'index.html',
        content: `<!doctype html><html><body style="margin:0;overflow:hidden">
<canvas id="game" width="1280" height="720" style="display:block;width:100vw;height:100vh"></canvas>
<div id="cover" style="position:fixed;inset:0;background:#112233;color:#fff"><button id="start" disabled>Loading...</button></div>
<script type="module" src="./src/main.js"></script></body></html>`,
      },
      {
        path: 'src/main.js',
        content: `
let phase = 'loading';
let px = 0;
let diagnosticStage = 'idle';
const btn = document.getElementById('start');
const cover = document.getElementById('cover');
const ctx = document.getElementById('game').getContext('2d');
ctx.fillStyle = '#224466'; ctx.fillRect(0, 0, 1280, 720);
setTimeout(() => { phase = 'ready'; btn.disabled = false; btn.textContent = 'Enter'; }, 250);
btn.addEventListener('click', () => { phase = 'explore'; cover.remove(); });
addEventListener('keydown', e => { if (phase === 'explore' && (e.key === 'd' || e.key === 'D')) px += 2; });
window.__omGame = {
  getState: () => ({ selfId: 'p1', phase, diagnosticStage, players: { p1: { connected: true, x: px, z: 0 } } }),
  getStats: () => ({ drawCalls: 1, triangles: 240, entities: 1, kinematics: { hero: { frames: 20, walkZeroFlips: 0, maxBoneStepRad: 0.12, maxYawStepRad: 0.08 } } }),
  sendAction: (action) => {
    if (action?.type === 'setStage' && typeof action.stage === 'string') {
      diagnosticStage = action.stage;
      ctx.fillStyle = '#662244'; ctx.fillRect(0, 0, 1280, 720);
    }
  },
  runSelfTests: () => ({
    coverUnmounted: { pass: !document.getElementById('cover'), detail: document.getElementById('cover') ? 'still mounted' : 'removed' },
    finitePos: { pass: Number.isFinite(px), detail: String(px) },
  }),
};`,
      },
    ]);

    const result = await service.playtest(game.id, {
      clients: 1,
      durationMs: 300,
      waitForReadyMs: 5000,
      scripts: [[
        { type: 'screenshot', label: 'after_entry' },
        { type: 'action', action: { type: 'setStage', stage: 'boss_phase2' } },
        { type: 'key', key: 'd', event: 'press' },
        { type: 'wait', ms: 80 },
        { type: 'screenshot', label: 'boss_phase2' },
        { type: 'burst', count: 2, intervalMs: 60, label: 'motion' },
      ]],
    });
    const client = result.clients[0];
    assert.deepEqual(client.consoleErrors, []);
    assert.deepEqual(client.failedRequests, []);
    assert.equal(client.screenshots?.length, 4);
    assert.equal(client.screenshots?.[0].label, 'after_entry');
    assert.equal(client.screenshots?.[1].label, 'boss_phase2');
    assert.equal(client.screenshots?.[2].label, 'motion_1');
    assert.equal(client.screenshots?.[3].label, 'motion_2');
    assert.equal(client.authoritative?.state?.diagnosticStage, 'boss_phase2');
    assert.equal(client.authoritative?.stats?.drawCalls, 1);
    if (client.contactSheetPath) {
      const sheetBytes = await readFile(client.contactSheetPath);
      assert.ok(sheetBytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), 'contactSheetPath should be a valid PNG');
      assert.match(client.contactSheetLegend ?? '', /r1c1=after_entry/);
      assert.match(client.contactSheetLegend ?? '', /r1c2=boss_phase2/);
      assert.match(client.contactSheetLegend ?? '', /r2c1=motion_1/);
      assert.match(client.contactSheetLegend ?? '', /r2c2=motion_2/);
    }
    const missingSheet = await buildPlaytestContactSheet(client.screenshots!, path.join(service.root, 'missing-sheet.png'), {
      ffmpeg: '/nonexistent/ffmpeg-binary',
    });
    assert.equal(missingSheet, null, 'buildPlaytestContactSheet should degrade gracefully when ffmpeg is unavailable');
    assert.equal(client.assertions.find((a: any) => a.name === 'phase')?.passed, true);
    assert.equal(client.assertions.find((a: any) => a.name === 'scriptedMovement')?.passed, true);
    assert.equal(client.assertions.find((a: any) => a.name === 'kinematics:hero:noWalkFlicker')?.passed, true);
    assert.equal(client.assertions.find((a: any) => a.name === 'kinematics:hero:smoothBoneMotion')?.passed, true);
    assert.equal(client.assertions.find((a: any) => a.name === 'kinematics:hero:smoothYaw')?.passed, true);
    assert.equal(client.assertions.find((a: any) => a.name === 'selfTest:coverUnmounted')?.passed, true);
    assert.equal(client.assertions.find((a: any) => a.name === 'selfTest:finitePos')?.passed, true);
  });
});

test('Option B + H4: AssetLibrary imports/reads local .glb, buildPublishBundle optimizes GLB textures to EXT_texture_webp, and exportZip produces runnable offline bundle', () =>
  withWorkspace(async (workspace, service) => {
    const store = new WorkspaceStore(workspace);
    const library = new AssetLibrary(store);

    // 1. Create a synthetic GLB with large embedded PNG and import into AssetLibrary.
    const png = makeSyntheticPng(512, 512);
    const glbBytes = makeSyntheticGlb(png);
    const glbPath = path.join(workspace, 'hero.glb');
    await writeFile(glbPath, glbBytes);

    const { asset } = await assetOperation(store, {
      action: 'import',
      requestId: 'import-hero-glb-1',
      sourcePath: glbPath,
      name: 'Hero Model',
    });
    assert.equal(asset.modality, '3d');
    const version = asset.versions[0];
    assert.equal(version.mimeType, 'model/gltf-binary');
    assert.equal(version.filename, 'media.glb');
    assert.equal((version.result?.glb as any)?.triangleCount, 1);

    // 1b. Generated 3D versions carrying provider result metadata still keep authoritative local GLB inspection.
    const generatedPrepared = await library.prepare(glbPath);
    const generatedAsset = await store.lock(() => library.addLocked(generatedPrepared, {
      name: 'Generated Boss',
      expectedModality: '3d',
      version: {
        source: 'generated',
        name: 'Generated Boss',
        result: { providerJobId: 'tripo-job-1', qualityTier: 'high', glb: 'stale-provider-summary' },
      },
    }));
    const generatedVersion = generatedAsset.versions[0];
    assert.equal((generatedVersion.result as any)?.providerJobId, 'tripo-job-1');
    assert.equal((generatedVersion.result as any)?.qualityTier, 'high');
    assert.equal((generatedVersion.result?.glb as any)?.triangleCount, 1);

    // 2. Listing by modality:'3d' and reading via readLibraryAsset work cleanly.
    const listed = await library.list({ modality: '3d' });
    assert.equal(listed.assets.length, 2);
    assert.ok(listed.assets.some(a => a.id === asset.id));
    assert.ok(listed.assets.some(a => a.id === generatedAsset.id));
    const readRes = await readLibraryAsset(library, { assetId: asset.id, versionId: version.id });
    assert.equal(readRes.modality, '3d');
    assert.match((readRes.content[0] as any).text, /3D GLB model/);

    // 3. Verify graceful fallback when no WebP encoder is present, then deterministic EXT_texture_webp optimization.
    const prevCwebp = process.env.CWEBP_PATH;
    const prevFfmpeg = process.env.HYPERFRAMES_FFMPEG_PATH;
    try {
      process.env.CWEBP_PATH = path.join(workspace, 'missing-cwebp');
      process.env.HYPERFRAMES_FFMPEG_PATH = path.join(workspace, 'missing-ffmpeg');
      const fallbackOpt = await optimizeGlbTexturesForPublish(glbBytes);
      assert.equal(fallbackOpt.optimized, false);
      assert.equal(fallbackOpt.data.length, glbBytes.length);

      // Deterministic cwebp test wrapper (same pattern as tests/web-publish.test.ts) so CI passes regardless of host codecs.
      const fakeCwebp = path.join(workspace, 'fake-cwebp.mjs');
      await writeFile(
        fakeCwebp,
        `#!${process.execPath}\nimport fs from 'node:fs';\nconst out = process.argv[process.argv.indexOf('-o') + 1];\nconst payload = Buffer.from('524946461a000000574542505650384c0d0000002f00000010071011118888fe0700', 'hex');\nfs.writeFileSync(out, payload);\n`,
      );
      await chmod(fakeCwebp, 0o755);
      process.env.CWEBP_PATH = fakeCwebp;

      const opt = await optimizeGlbTexturesForPublish(glbBytes);
      assert.equal(opt.optimized, true, 'Expected cwebp encoder to optimize embedded PNG inside GLB');
      assert.equal(opt.convertedImages, 1);
      assert.ok(opt.savedBytes > png.length * 0.5, `Expected significant savings, got ${opt.savedBytes}`);
      const optInfo = inspectGlb(opt.data);
      assert.equal(optInfo.triangleCount, 1);
      assert.deepEqual(optInfo.bounds, inspectGlb(glbBytes).bounds);
      assert.equal(optInfo.images[0].mimeType, 'image/webp');
      assert.ok(optInfo.extensionsUsed.includes('EXT_texture_webp'));

      // 4. Game referencing library .glb + assets-raw master -> buildPublishBundle & exportZip.
      const { game } = await service.create({
        prompt: 'Offline GLB showcase',
        genre: 'casual',
        style: '3d',
        setting: null,
        multiplayer: false,
      });
      const mediaUrl = `/motion-api/assets/${asset.id}/versions/${version.id}/media`;
      await service.write(game.id, [
        { path: 'index.html', content: '<!doctype html><canvas id="game"></canvas><script type="module" src="./src/main.js"></script>' },
        { path: 'src/main.js', content: `export const HERO_URL = "${mediaUrl}";` },
      ]);
      await mkdir(path.join(service.root, game.id, 'assets-raw'), { recursive: true });
      await writeFile(path.join(service.root, game.id, 'assets-raw', 'master-4k.glb'), glbBytes);

      const bundle = await buildPublishBundle({
        dataDirectory: workspace,
        kind: 'game',
        targetId: game.id,
        sourcePath: path.join(service.root, game.id),
        entryPath: 'index.html',
      });
      assert.equal(bundle.files.some(f => f.file.startsWith('assets-raw/')), false, 'assets-raw must be excluded');
      const bundledGlb = bundle.files.find(f => f.file.startsWith('_shared-assets/') && f.file.endsWith('.glb'));
      assert.ok(bundledGlb, 'Library GLB should be bundled into _shared-assets/*.glb');
      assert.ok(bundledGlb.data.length < glbBytes.length * 0.5, 'Bundled library GLB should be WebP-optimized');
      assert.equal(bundle.sizeBreakdown.optimizedGlbCount, 1);
      assert.ok(bundle.sizeBreakdown.savedBytes > 0);
      const rewrittenMain = bundle.files.find(f => f.file === 'src/main.js')!.data.toString('utf8');
      assert.doesNotMatch(rewrittenMain, /\/motion-api\/assets\//);
      assert.match(rewrittenMain, /"\.\/_shared-assets\/[^"]*\.glb"/);
      assert.doesNotMatch(rewrittenMain, /\.\.\/_shared-assets\//);

      // 5. exportZip produces an archive with launchers, no design/assets-raw, and a runnable serve.mjs.
      const exported = await service.exportZip(game.id);
      assert.ok(exported.filename.endsWith('.zip'));
      const extractDir = path.join(workspace, 'extracted');
      const zipFile = path.join(workspace, 'game.zip');
      await writeFile(zipFile, exported.data);
      await mkdir(extractDir, { recursive: true });
      await execFileAsync('unzip', ['-q', zipFile, '-d', extractDir]);

      const serveJs = await readFile(path.join(extractDir, 'serve.mjs'), 'utf8');
      assert.match(serveJs, /model\/gltf-binary/);
      assert.ok(await readFile(path.join(extractDir, 'Start-Mac.command'), 'utf8'));
      assert.ok(await readFile(path.join(extractDir, 'Start-Windows.bat'), 'utf8'));
      assert.ok(await readFile(path.join(extractDir, 'PLAY-README.txt'), 'utf8'));
      await assert.rejects(readFile(path.join(extractDir, 'game.json')));
      await assert.rejects(readFile(path.join(extractDir, 'assets-raw', 'master-4k.glb')));

      // Boot serve.mjs on a test port and fetch both index.html and the bundled GLB.
      const port = 18765 + (process.pid % 1000);
      const child = spawn(process.execPath, ['serve.mjs'], {
        cwd: extractDir,
        env: { ...process.env, PORT: String(port) },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      try {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('serve.mjs timed out')), 5000);
          child.stdout.on('data', chunk => {
            if (String(chunk).includes('Game server running')) {
              clearTimeout(timer);
              resolve();
            }
          });
          child.once('exit', code => {
            clearTimeout(timer);
            reject(new Error(`serve.mjs exited early with ${code}`));
          });
        });
        const htmlRes = await fetch(`http://127.0.0.1:${port}/`);
        assert.equal(htmlRes.status, 200);
        const glbRes = await fetch(`http://127.0.0.1:${port}/${bundledGlb.file}`);
        assert.equal(glbRes.status, 200);
        assert.equal(glbRes.headers.get('content-type'), 'model/gltf-binary');
        const fetchedGlb = Buffer.from(await glbRes.arrayBuffer());
        assert.equal(inspectGlb(fetchedGlb).images[0].mimeType, 'image/webp');
      } finally {
        child.kill('SIGTERM');
      }
    } finally {
      if (prevCwebp === undefined) delete process.env.CWEBP_PATH; else process.env.CWEBP_PATH = prevCwebp;
      if (prevFfmpeg === undefined) delete process.env.HYPERFRAMES_FFMPEG_PATH; else process.env.HYPERFRAMES_FFMPEG_PATH = prevFfmpeg;
    }
  }));

test('H5: HumanoidRigController eliminates 30Hz leg flicker, 1-frame joint snaps, over-extended IK and hand-socket scale drift', async () => {
  const T = await import('../templates/game-kits/vendor/three.module.min.js');
  const { createHumanoidRig, sampleActionCurve, shortestAngleDelta } = await import('../templates/game-kits/vendor/HumanoidRigController.js');

  // Build a synthetic Mixamo-style humanoid skeleton with rotated rest quaternions (like Tripo Mixamo GLBs).
  const scene = new T.Group();
  const rootBone = new T.Bone(); rootBone.name = 'Root'; rootBone.quaternion.set(-0.5, 0.5, 0.5, 0.5);
  const hips = new T.Bone(); hips.name = 'mixamorig:Hips'; hips.position.set(0, 0, 0.54); hips.quaternion.set(0.493, -0.493, -0.456, 0.554).normalize();
  const spine = new T.Bone(); spine.name = 'mixamorig:Spine'; spine.position.set(0, 0.05, 0); spine.quaternion.set(0, 0.671, 0, 0.742).normalize();
  const spine1 = new T.Bone(); spine1.name = 'mixamorig:Spine1'; spine1.position.set(0, 0.07, 0);
  const spine2 = new T.Bone(); spine2.name = 'mixamorig:Spine2'; spine2.position.set(0, 0.07, 0);
  const head = new T.Bone(); head.name = 'mixamorig:Head'; head.position.set(0, 0.11, 0);
  const lSh = new T.Bone(); lSh.name = 'mixamorig:LeftShoulder'; lSh.position.set(0.06, 0.06, 0);
  const lArm = new T.Bone(); lArm.name = 'mixamorig:LeftArm'; lArm.position.set(0.08, 0, 0);
  const lFore = new T.Bone(); lFore.name = 'mixamorig:LeftForeArm'; lFore.position.set(0.06, -0.14, 0);
  const lHand = new T.Bone(); lHand.name = 'mixamorig:LeftHand'; lHand.position.set(0.05, -0.13, 0);
  const rSh = new T.Bone(); rSh.name = 'mixamorig:RightShoulder'; rSh.position.set(-0.06, 0.06, 0);
  const rArm = new T.Bone(); rArm.name = 'mixamorig:RightArm'; rArm.position.set(-0.08, 0, 0);
  const rFore = new T.Bone(); rFore.name = 'mixamorig:RightForeArm'; rFore.position.set(-0.06, -0.14, 0);
  const rHand = new T.Bone(); rHand.name = 'mixamorig:RightHand'; rHand.position.set(-0.05, -0.13, 0);
  const lUp = new T.Bone(); lUp.name = 'mixamorig:LeftUpLeg'; lUp.position.set(0.05, 0, -0.05); lUp.quaternion.set(0.648, -0.186, 0.738, 0.005).normalize();
  const lLeg = new T.Bone(); lLeg.name = 'mixamorig:LeftLeg'; lLeg.position.set(0, 0.27, 0);
  const lFoot = new T.Bone(); lFoot.name = 'mixamorig:LeftFoot'; lFoot.position.set(0, 0.25, 0);
  const rUp = new T.Bone(); rUp.name = 'mixamorig:RightUpLeg'; rUp.position.set(-0.05, 0, 0.05); rUp.quaternion.set(0.672, -0.058, 0.725, 0.14).normalize();
  const rLeg = new T.Bone(); rLeg.name = 'mixamorig:RightLeg'; rLeg.position.set(0, 0.27, 0);
  const rFoot = new T.Bone(); rFoot.name = 'mixamorig:RightFoot'; rFoot.position.set(0, 0.25, 0);

  rootBone.add(hips);
  hips.add(spine, lUp, rUp);
  spine.add(spine1); spine1.add(spine2); spine2.add(head, lSh, rSh);
  lSh.add(lArm); lArm.add(lFore); lFore.add(lHand);
  rSh.add(rArm); rArm.add(rFore); rFore.add(rHand);
  lUp.add(lLeg); lLeg.add(lFoot);
  rUp.add(rLeg); rLeg.add(rFoot);
  scene.add(rootBone);

  // Include an opaque mesh mistakenly flagged transparent=true (GLB alphaMode: BLEND trap).
  const bodyMat = new T.MeshStandardMaterial({ transparent: true, opacity: 1, depthWrite: false });
  const bodyMesh = new T.Mesh(new T.BoxGeometry(0.4, 1.0, 0.2), bodyMat);
  bodyMesh.name = 'HeroRobe';
  bodyMesh.position.y = 0.5;
  scene.add(bodyMesh);

  // Track uses sanitized/variant Mixamo name (`mixamorigSpine`) against colon-named bone (`mixamorig:Spine`).
  const idleTrack = new T.QuaternionKeyframeTrack('mixamorigSpine.quaternion', [0, 0.5, 1], [0, 0.671, 0, 0.742, 0.12, 0.665, 0, 0.737, 0, 0.671, 0, 0.742]);
  const idleClip = new T.AnimationClip('preset:idle', 1, [idleTrack]);
  const slashClip = new T.AnimationClip('preset:slash', 0.6, [idleTrack]);

  const rig = createHumanoidRig({ scene, animations: [idleClip] }, { height: 2.0, name: 'boss' });
  assert.equal(rig.metrics.boneCount, 20);
  assert.ok(rig.bones.RightHand && rig.bones.Spine && rig.bones.LeftUpLeg);
  assert.equal(rig.hasNativeClips, true);
  assert.deepEqual(rig.addClips([slashClip], { 0: 'slash' }), ['slash']);
  assert.ok(rig.playClip('idle'));
  const spineBeforeClip = rig.bones.Spine.quaternion.clone();
  rig.update(0.25);
  assert.ok(rig.bones.Spine.quaternion.angleTo(spineBeforeClip) > 0.01, 'Cross-named Mixamo track must animate target bone');
  assert.ok(rig.playClip('slash', { loop: false, fade: 0.1 }));

  // Opaque BLEND material trap is hardened automatically.
  let hardenedOpaque = false;
  rig.model.traverse((obj: any) => {
    if (obj.name === 'HeroRobe') hardenedOpaque = obj.material.transparent === false && obj.material.depthWrite === true;
  });
  assert.equal(hardenedOpaque, true);

  // Real bone-socket mounting preserves real-world 1.0m weapon scale despite 2.0x model scale.
  const dao = new T.Group();
  const tip = new T.Object3D();
  tip.position.set(0, 1.0, 0);
  dao.add(tip);
  assert.ok(rig.attachToBone('RightHand', dao));
  const handPos = rig.getSocketWorldPosition('RightHand');
  const tipPos = tip.getWorldPosition(new T.Vector3());
  assert.ok(Math.abs(handPos.distanceTo(tipPos) - 1.0) < 0.02, `Expected ~1.0m weapon length, got ${handPos.distanceTo(tipPos)}`);

  // Stop clips to stress-test procedural IK + 30Hz logic stepping under 120Hz rendering + abrupt pose/yaw snaps.
  rig.stopClips(0);
  rig.syncTransform(0, 0, 0, 0, 0, { immediate: true });
  rig.update(0, { immediate: true, spineX: 0.15, crouch: 0.08, rightHand: [-0.4, 1.15, 0.3] });
  rig.resetTelemetry();

  let logicX = 0;
  let acc = 0;
  for (let frame = 0; frame < 120; frame++) {
    const dt = 1 / 120;
    acc += dt;
    while (acc >= 1 / 30) {
      logicX += 0.11;
      acc -= 1 / 30;
    }
    rig.syncTransform(logicX, 0, 0, frame >= 60 ? Math.PI : 0, dt);
    const pose = frame < 40
      ? { spineX: 0.16, spineY: -0.2, crouch: 0.08, rightHand: [-0.4, 1.15, 0.3] }
      : frame < 80
        ? { spineX: -0.2, spineY: 0.35, crouch: 0.03, rightHand: [-0.1, 2.5, 1.2] } // intentionally far beyond reach
        : { spineX: 0.35, spineY: -0.3, crouch: 0.14, rightHand: [0.5, 0.9, 1.0] };
    rig.update(dt, pose);
  }

  const telemetry = rig.getTelemetry();
  assert.equal(telemetry.walkZeroFlips, 0, '30Hz logic at 120Hz render must never flicker walk01 to zero');
  assert.ok(telemetry.maxBoneStepRad <= 0.65, `Bone step ${telemetry.maxBoneStepRad} exceeded 0.65 rad/frame`);
  assert.ok(telemetry.maxYawStepRad <= 0.45, `Yaw step ${telemetry.maxYawStepRad} exceeded 0.45 rad/frame`);
  assert.ok(telemetry.overExtendedIkCount > 0, 'Expected over-extended IK targets to be counted and clamped');
  assert.ok(Number.isFinite(rig.getSocketWorldPosition('RightHand').x));

  // Verify shortestAngleDelta wrap-around and asymmetric 3-beat action curve.
  assert.ok(Math.abs(shortestAngleDelta(Math.PI * 0.95, -Math.PI * 0.95) - Math.PI * 0.1) < 1e-6);
  assert.equal(sampleActionCurve(0.15).phase, 'anticipation');
  assert.equal(sampleActionCurve(0.36).phase, 'strike');
  assert.equal(sampleActionCurve(0.75).phase, 'followThrough');

  // Regression: angular velocity clamp must advance by ~maxStepRad instead of freezing at 0 when stepAngle > maxStepRad.
  rig.stopClips(0);
  rig.update(0, { immediate: true, spineX: 0 });
  const spineBeforeClamp = rig.bones.Spine.quaternion.clone();
  const clampResult = rig.update(1 / 30, { spineX: 1.5, rate: 80, maxStepRad: 0.12 });
  const spineMoved = spineBeforeClamp.angleTo(rig.bones.Spine.quaternion);
  assert.ok(spineMoved > 0.08 && spineMoved <= 0.125, `Expected clamped bone to advance ~0.12 rad, moved ${spineMoved}`);
  assert.ok(clampResult.frameMaxBoneStep > 0.08 && clampResult.frameMaxBoneStep <= 0.125);

  // Regression: playOnce auto-returns to prior looping clip, and holdEnd keeps clamped end pose without resetting to rest.
  const qIdle = new T.Quaternion().setFromEuler(new T.Euler(0.05, 0, 0));
  const qAttack = new T.Quaternion().setFromEuler(new T.Euler(0.6, 0, 0));
  const qFall = new T.Quaternion().setFromEuler(new T.Euler(1.1, 0, 0));
  const makeTrack = (q: any) => new T.QuaternionKeyframeTrack('mixamorig:Spine.quaternion', [0, 0.2], [
    q.x, q.y, q.z, q.w, q.x, q.y, q.z, q.w,
  ]);
  rig.addClips([
    new T.AnimationClip('preset:idle', 0.2, [makeTrack(qIdle)]),
    new T.AnimationClip('preset:attack', 0.2, [makeTrack(qAttack)]),
    new T.AnimationClip('preset:fall', 0.2, [makeTrack(qFall)]),
  ]);
  assert.ok(rig.playClip('idle', { fade: 0 }), 'resolveClipName should match preset:idle via "idle"');
  rig.update(0.05);
  assert.ok(rig.playOnce('attack', { fade: 0, returnFade: 0 }));
  for (let i = 0; i < 10; i++) rig.update(0.05);
  assert.equal(rig.activeClip, 'preset:idle', 'playOnce should automatically return to prior looping clip');

  assert.ok(rig.playOnce('fall', { fade: 0, holdEnd: true }));
  for (let i = 0; i < 12; i++) rig.update(0.05);
  assert.equal(rig.activeClip, 'preset:fall');
  assert.ok(rig.bones.Spine.quaternion.angleTo(qFall) < 0.05, 'holdEnd clip must stay clamped at end pose instead of resetting to rest');
  assert.ok(rig.getTelemetry().clipPlayedFrames >= 20);

  // Cross-skeleton retargeting: transfer real bundled CC0 Knight.glb clips (KayKit T-pose) onto synthetic Mixamo rig.
  const { GLTFLoader } = await import('../templates/game-kits/vendor/GLTFLoader.js');
  (globalThis as any).self ??= globalThis;
  const knightBuf = await readFile(new URL('../templates/game-kits/characters/Knight.glb', import.meta.url));
  const knightAb = knightBuf.buffer.slice(knightBuf.byteOffset, knightBuf.byteOffset + knightBuf.byteLength);
  const knightGltf: any = await new Promise((resolve, reject) => new GLTFLoader().parse(knightAb, '', resolve, reject));
  const retargetedNames = rig.retargetClipsFrom(knightGltf, { names: ['Running_A', 'Death_A'], fps: 20 });
  assert.deepEqual(retargetedNames.sort(), ['Death_A', 'Running_A']);
  assert.ok(rig.playClip('Running_A', { fade: 0 }));
  for (let i = 0; i < 8; i++) rig.update(1 / 30);
  assert.ok(Number.isFinite(rig.bones.RightUpLeg.quaternion.x));

  // Regression: retarget baking must evaluate t = duration without LoopRepeat wrapping back to t = 0.
  assert.ok(rig.playOnce('Death_A', { fade: 0, holdEnd: true }));
  rig.update(0.01);
  const hipsStartQ = rig.bones.Hips.quaternion.clone();
  for (let i = 0; i < 30; i++) rig.update(0.05); // 1.5s > Death_A duration (0.8s)
  const hipsEndQ = rig.bones.Hips.quaternion.clone();
  assert.ok(
    hipsStartQ.angleTo(hipsEndQ) > 0.8,
    `Expected retargeted Death_A holdEnd pose to hold fallen end pose (>0.8 rad from start), got ${hipsStartQ.angleTo(hipsEndQ)}`,
  );

  // Regression: low-FPS (20 fps) sharp turn + pose switch stays within controller per-second caps and passes rate-normalized assertions.
  rig.stopClips(0);
  rig.syncTransform(0, 0, 0, 0, 0, { immediate: true });
  rig.update(0, { immediate: true, spineX: 0 });
  rig.resetTelemetry();
  for (let frame = 0; frame < 24; frame++) {
    const dt = 1 / 20;
    rig.syncTransform(frame * 0.15, 0, 0, frame >= 6 ? Math.PI : 0, dt);
    rig.update(dt, { spineX: frame >= 6 ? 0.5 : -0.2, spineY: frame >= 6 ? 0.4 : -0.3 });
  }
  const lowFpsTelemetry = rig.getTelemetry();
  assert.ok(lowFpsTelemetry.maxYawStepRad > 0.45, 'Expected 20fps turn per-frame yaw step > 0.45 rad');
  assert.ok(lowFpsTelemetry.maxYawRadPerSec <= 14.05, `Expected yaw rate <= 14 rad/s, got ${lowFpsTelemetry.maxYawRadPerSec}`);
  assert.ok(lowFpsTelemetry.maxBoneRadPerSec <= 16.05, `Expected bone rate <= 16 rad/s, got ${lowFpsTelemetry.maxBoneRadPerSec}`);
  const lowFpsAssertions = normalizeKinematicsAssertions(lowFpsTelemetry);
  assert.ok(lowFpsAssertions.every(a => a.passed), `20fps controller telemetry must pass kinematics assertions: ${JSON.stringify(lowFpsAssertions)}`);
  rig.dispose();
});

test('H6: validate detects 3D kinematics anti-patterns, scaffolds HumanoidRigController.js, and playtest validates burst + kinematics assertions', () =>
  withWorkspace(async (_workspace, service) => {
    const { game } = await service.create({
      prompt: '3D third-person wuxia sword boss duel',
      genre: 'casual',
      style: '3d',
      setting: null,
      multiplayer: false,
    });
    // style: '3d' automatically scaffolds vendor/HumanoidRigController.js alongside Three.js.
    const rigController = await readFile(path.join(service.root, game.id, 'vendor/HumanoidRigController.js'), 'utf8');
    assert.match(rigController, /export function createHumanoidRig/);

    // Broken manual IK actor (rest-pose reset without slerp + raw frame-delta walking on 30Hz logic) triggers warnings.
    await service.write(game.id, [
      { path: 'index.html', content: '<!doctype html><canvas id="game"></canvas><script type="module" src="./client.js"></script>' },
      { path: 'client.js', content: 'import { animateActor } from "./actors.js"; import * as L from "./logic.js"; export { animateActor, L };' },
      {
        path: 'actors.js',
        content: `
import * as T from './vendor/three.module.min.js';
let previous = null;
export function animateActor(sk, rest, s) {
  const delta = previous ? Math.hypot(s.x - previous.x, s.z - previous.z) : 0;
  previous = { x: s.x, z: s.z };
  const walking = delta > 0.001;
  for (const k in sk) sk[k].quaternion.copy(rest[k]);
  return walking ? T.MathUtils.clamp(delta, 0, 1) : 0;
}`,
      },
    ]);
    const badValidation = await service.validate(game.id);
    assert.equal(badValidation.passed, true);
    assert.ok(badValidation.warnings.some(w => /quaternion\.copy.*HumanoidRigController/i.test(w)), JSON.stringify(badValidation.warnings));
    assert.ok(badValidation.warnings.some(w => /30 Hz leg flicker/i.test(w)), JSON.stringify(badValidation.warnings));

    // DIY bounding-box humanoid skinning also triggers a clear warning.
    const diyWarnings = inspect3dKinematicsWarnings(
      new Map([['actors.js', `import { GLTFLoader } from './vendor/GLTFLoader.js'; geo.setAttribute('skinWeight', weights); const b = 'mixamorig:RightArm';`]]),
      { hasFixedLogicTick: false },
    );
    assert.ok(diyWarnings.some(w => /DIY bounding-box skinning/i.test(w)));

    // Clean actor using vendor/HumanoidRigController.js emits zero kinematics warnings.
    await service.write(game.id, [
      {
        path: 'actors.js',
        content: `
import { createHumanoidRig } from './vendor/HumanoidRigController.js';
export function mountActor(gltf) { const rig = createHumanoidRig(gltf, { height: 1.8 }); rig.playClip('idle'); return rig; }`,
      },
    ]);
    const cleanValidation = await service.validate(game.id);
    assert.equal(cleanValidation.warnings.some(w => /3D kinematics|3D rigging|3D motion/i.test(w)), false, JSON.stringify(cleanValidation.warnings));

    // Manual arm-IK-only HumanoidRigController with zero clip playback emits a clear motion advisory warning.
    const ikOnlyWarnings = inspect3dKinematicsWarnings(
      new Map([['actors.js', `import { createHumanoidRig } from './vendor/HumanoidRigController.js'; export function f(g, dt) { const r = createHumanoidRig(g); r.update(dt, { rightHand: [0, 1, 0.5] }); }`]]),
      { hasFixedLogicTick: true },
    );
    assert.ok(ikOnlyWarnings.some(w => /3D motion advisory.*playClip\/playOnce/i.test(w)), JSON.stringify(ikOnlyWarnings));
    const clipPlusIkWarnings = inspect3dKinematicsWarnings(
      new Map([['actors.js', `import { createHumanoidRig } from './vendor/HumanoidRigController.js'; export function f(g, dt) { const r = createHumanoidRig(g); r.playOnce('slash'); r.update(dt, { rightHand: [0, 1, 0.5] }); }`]]),
      { hasFixedLogicTick: true },
    );
    assert.equal(clipPlusIkWarnings.length, 0);

    // validateGameScript validates burst action bounds and total 8-screenshot budget.
    const burstScript = validateGameScript([
      { type: 'screenshot', label: 'entry' },
      { type: 'burst', count: 4, intervalMs: 100, label: 'strike' },
      { type: 'screenshot', label: 'victory' },
    ]);
    assert.equal(burstScript.length, 3);
    assert.throws(() => validateGameScript([{ type: 'burst', count: 1 }]), /Burst count/);
    assert.throws(() => validateGameScript([{ type: 'burst', count: 4, intervalMs: 10 }]), /Burst intervalMs/);
    assert.throws(
      () => validateGameScript([
        { type: 'burst', count: 5, label: 'a' },
        { type: 'burst', count: 4, label: 'b' },
      ]),
      /at most 8 screenshot/,
    );

    // normalizeKinematicsAssertions passes clean rate-normalized & legacy step telemetry and fails flickery/snapping/over-extended rigs.
    const goodChecks = normalizeKinematicsAssertions({
      hero: { frames: 60, walkZeroFlips: 0, maxBoneStepRad: 0.72, maxBoneRadPerSec: 15.8, maxYawStepRad: 0.68, maxYawRadPerSec: 13.9, overExtendedIkCount: 4 },
      boss: { frames: 60, walkZeroFlips: 0, maxBoneStepRad: 0.22, maxYawStepRad: 0.12, overExtendedIkCount: 0 },
    });
    assert.equal(goodChecks.length, 8);
    assert.ok(goodChecks.every(c => c.passed));

    const badRateChecks = normalizeKinematicsAssertions({
      frames: 60,
      walkZeroFlips: 0,
      maxBoneRadPerSec: 45,
      maxYawRadPerSec: 32,
    });
    assert.equal(badRateChecks.find(c => c.name === 'kinematics:smoothBoneMotion')?.passed, false);
    assert.equal(badRateChecks.find(c => c.name === 'kinematics:smoothYaw')?.passed, false);

    const badChecks = normalizeKinematicsAssertions({
      frames: 60,
      walkZeroFlips: 14,
      maxBoneStepRad: 1.92,
      maxYawStepRad: 1.15,
      overExtendedIkCount: 106,
    });
    assert.equal(badChecks.length, 4);
    assert.ok(badChecks.every(c => !c.passed));
    assert.equal(badChecks.find(c => c.name === 'kinematics:ikReach')?.passed, false);

    // gamePlaytestAssertions integrates stats.kinematics automatically and stays silent when absent.
    const assertionsWithKinematics = gamePlaytestAssertions({
      before: { state: { selfId: 'p1', players: { p1: { x: 0, z: 0 } } } },
      after: {
        state: { selfId: 'p1', phase: 'playing', players: { p1: { connected: true, x: 2, z: 0 } } },
        stats: { kinematics: { hero: { frames: 40, walkZeroFlips: 9, maxBoneStepRad: 0.2, maxYawStepRad: 0.1 } } },
      },
      clients: 1,
      script: [{ type: 'key', key: 'd', event: 'press' }],
      mobile: { width: 390, height: 844, scrollWidth: 390, overflowElements: [] },
    });
    assert.equal(assertionsWithKinematics.find(a => a.name === 'kinematics:hero:noWalkFlicker')?.passed, false);
    assert.equal(assertionsWithKinematics.find(a => a.name === 'kinematics:hero:smoothBoneMotion')?.passed, true);
  }));
