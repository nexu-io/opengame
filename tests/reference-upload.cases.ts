import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { chmod, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { execute, pluginRoot } from '../hyperframes.ts';
import { verificationBinaries } from '../scripts/verify-export.ts';
import {
  OPEN_DESIGN_LEGACY_UPLOAD_LIMIT_BYTES,
  OPEN_DESIGN_LEGACY_UPLOAD_TARGET_BYTES,
  OPEN_DESIGN_MAX_SOURCE_REFERENCE_BYTES,
  OPEN_DESIGN_UPLOAD_SOFT_BUDGET_BYTES,
} from '../shared/asset-limits.ts';
import {
  clearLearnedOpenDesignUploadLimits,
  clearReferenceEncoderCache,
  computeOpenDesignPerImageBudget,
  detectReferenceImageMime,
  getLearnedOpenDesignUploadLimit,
  imageMayHaveTransparency,
  prepareCloudReference,
  probeReferenceEncoders,
  ReferencePreparationError,
  setReferenceEncoderCapabilitiesForTests,
  uploadOpenDesignReference,
} from '../gateway/reference-upload.ts';
import { uploadInputs } from '../gateway/opendesign.ts';
import { OpenDesignAccount } from '../gateway/account.ts';
import { classifyRejectionError } from '../gateway/media-telemetry.ts';
import { mediaGenerationError } from '../tracking/tool-fields.ts';
import { clearOpenDesign3dDiscoveryCache, runOpenDesign3dScript } from '../gateway/opendesign-3d.ts';
import { gatewayFor } from '../gateway/service.ts';
import { AssetLibrary } from '../gateway/asset-library.ts';
import { ProviderError, type Fetcher } from '../gateway/network.ts';
import { fixture } from './fixtures.ts';
import type { GenerationJob } from '../shared/gateway.ts';

async function generateNoisyPng(dir: string, name: string, width: number, height: number, alpha = false): Promise<{ file: string; bytes: Buffer }> {
  const file = path.join(dir, name);
  const expr = alpha
    ? `nullsrc=s=${width}x${height},format=rgba,geq=r='random(1)*255':g='random(2)*255':b='random(3)*255':a='if(lt(X,${Math.floor(width / 2)}),128,255)'`
    : `nullsrc=s=${width}x${height},format=rgb24,geq=r='random(1)*255':g='random(2)*255':b='random(3)*255'`;
  const res = await execute(verificationBinaries().ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', expr, '-frames:v', '1', '-y', file], dir, 30_000);
  assert.equal(res.code, 0, res.stderr);
  const bytes = await readFile(file);
  return { file, bytes };
}

test('probeReferenceEncoders verifies real encode support on this host', async () => {
  clearReferenceEncoderCache();
  const caps = await probeReferenceEncoders();
  assert.ok(caps.cwebp || caps.ffmpegLibwebp || caps.ffmpegPng || caps.sipsPng, 'expected at least one alpha-capable encoder');
  assert.ok(caps.cwebp || caps.ffmpegLibwebp || caps.ffmpegJpeg || caps.sipsJpeg, 'expected at least one opaque encoder');
});

test('prepareCloudReference preserves originals under budget, compresses >2 MiB opaque & alpha PNGs cleanly, and never flattens alpha to JPEG', () => fixture(async store => {
  clearReferenceEncoderCache();
  const opaque = await generateNoisyPng(store.directory, 'opaque-big.png', 1300, 1300, false);
  assert.ok(opaque.bytes.length > OPEN_DESIGN_LEGACY_UPLOAD_LIMIT_BYTES, `expected >2 MiB opaque PNG, got ${opaque.bytes.length}`);
  assert.equal(imageMayHaveTransparency(opaque.bytes, 'image/png'), false);

  // Within 8 MiB soft budget -> bit-exact passthrough.
  const passthrough = await prepareCloudReference({
    bytes: opaque.bytes,
    filename: 'opaque-big.png',
    maxBytes: OPEN_DESIGN_UPLOAD_SOFT_BUDGET_BYTES,
  });
  assert.equal(passthrough.compressed, false);
  assert.equal(passthrough.mimeType, 'image/png');
  assert.equal(passthrough.bytes.length, opaque.bytes.length);

  // Over 2 MiB budget -> compressed below 1,940,000 bytes with verified magic-byte MIME.
  const adaptedOpaque = await prepareCloudReference({
    bytes: opaque.bytes,
    filename: 'opaque-big.png',
    maxBytes: OPEN_DESIGN_LEGACY_UPLOAD_LIMIT_BYTES,
    targetBytes: OPEN_DESIGN_LEGACY_UPLOAD_TARGET_BYTES,
  });
  assert.equal(adaptedOpaque.compressed, true);
  assert.ok(adaptedOpaque.bytes.length <= OPEN_DESIGN_LEGACY_UPLOAD_TARGET_BYTES, `expected <= 1.94 MB, got ${adaptedOpaque.bytes.length}`);
  assert.equal(detectReferenceImageMime(adaptedOpaque.bytes), adaptedOpaque.mimeType);

  // Transparent RGBA PNG -> preserves transparency (WebP or PNG, never JPEG).
  const alpha = await generateNoisyPng(store.directory, 'alpha-big.png', 1400, 1400, true);
  assert.ok(alpha.bytes.length > OPEN_DESIGN_LEGACY_UPLOAD_LIMIT_BYTES, `expected >2 MiB alpha PNG, got ${alpha.bytes.length}`);
  assert.equal(imageMayHaveTransparency(alpha.bytes, 'image/png'), true);

  const adaptedAlpha = await prepareCloudReference({
    bytes: alpha.bytes,
    filename: 'alpha-big.png',
    maxBytes: OPEN_DESIGN_LEGACY_UPLOAD_LIMIT_BYTES,
    targetBytes: OPEN_DESIGN_LEGACY_UPLOAD_TARGET_BYTES,
    preserveAlpha: true,
  });
  assert.equal(adaptedAlpha.compressed, true);
  assert.ok(adaptedAlpha.bytes.length <= OPEN_DESIGN_LEGACY_UPLOAD_LIMIT_BYTES);
  assert.notEqual(adaptedAlpha.mimeType, 'image/jpeg');
  assert.equal(detectReferenceImageMime(adaptedAlpha.bytes), adaptedAlpha.mimeType);
  assert.equal(imageMayHaveTransparency(adaptedAlpha.bytes, adaptedAlpha.mimeType), true);

  // When WebP encoders are unavailable, alpha PNG must fall back to PNG downscale — NEVER JPEG!
  const realCaps = await probeReferenceEncoders();
  const pngOnlyCaps = {
    ...realCaps,
    cwebp: false,
    cwebpBin: undefined,
    ffmpegLibwebp: false,
  };
  const adaptedAlphaNoWebp = await prepareCloudReference({
    bytes: alpha.bytes,
    filename: 'alpha-big.png',
    maxBytes: OPEN_DESIGN_LEGACY_UPLOAD_LIMIT_BYTES,
    targetBytes: OPEN_DESIGN_LEGACY_UPLOAD_TARGET_BYTES,
    preserveAlpha: true,
    encoders: pngOnlyCaps,
  });
  assert.equal(adaptedAlphaNoWebp.compressed, true);
  assert.equal(adaptedAlphaNoWebp.mimeType, 'image/png');
  assert.ok(adaptedAlphaNoWebp.bytes.length <= OPEN_DESIGN_LEGACY_UPLOAD_LIMIT_BYTES);

  // Impossible budget for alpha PNG -> throws ReferencePreparationError instead of flattening to JPEG.
  await assert.rejects(
    prepareCloudReference({
      bytes: alpha.bytes,
      filename: 'alpha-big.png',
      maxBytes: 256,
      targetBytes: 200,
      preserveAlpha: true,
    }),
    (err: unknown) => err instanceof ReferencePreparationError && err.code === 'REFERENCE_TOO_LARGE' && /transparency/i.test(err.message),
  );

  // No encoder available -> throws loud REFERENCE_ENCODER_UNAVAILABLE (never swallows failure).
  await assert.rejects(
    prepareCloudReference({
      bytes: opaque.bytes,
      filename: 'opaque-big.png',
      maxBytes: OPEN_DESIGN_LEGACY_UPLOAD_LIMIT_BYTES,
      encoders: { cwebp: false, ffmpegLibwebp: false, ffmpegPng: false, ffmpegJpeg: false, sipsPng: false, sipsJpeg: false },
    }),
    (err: unknown) => err instanceof ReferencePreparationError && err.code === 'REFERENCE_ENCODER_UNAVAILABLE',
  );
}));

test('computeOpenDesignPerImageBudget enforces 8 MiB per image, 32 MiB per job, and learned origin caps', () => {
  clearLearnedOpenDesignUploadLimits();
  const origin = 'https://budget-test.example';
  assert.equal(
    computeOpenDesignPerImageBudget([6 * 1024 * 1024], { origin }),
    OPEN_DESIGN_UPLOAD_SOFT_BUDGET_BYTES,
  );
  assert.equal(
    computeOpenDesignPerImageBudget([6 * 1024 * 1024, 6 * 1024 * 1024, 6 * 1024 * 1024, 6 * 1024 * 1024], { origin }),
    OPEN_DESIGN_UPLOAD_SOFT_BUDGET_BYTES,
  );
  // 6 x 6 MiB = 36 MiB > 32 MiB job cap -> per-image share scales down to floor(32 MiB / 6).
  const scaled = computeOpenDesignPerImageBudget(new Array(6).fill(6 * 1024 * 1024), { origin });
  assert.equal(scaled, Math.floor((32 * 1024 * 1024) / 6));
  // Known lower limit from future OPEND-5839 schema takes precedence.
  assert.equal(
    computeOpenDesignPerImageBudget([6 * 1024 * 1024], { origin, knownMaxBytes: 4 * 1024 * 1024 }),
    4 * 1024 * 1024,
  );
});

test('uploadInputs handles post-OPEND-5519 raw passthrough, pre-OPEND-5519 /uploads 413 fallback with origin caching, mixed-rollout /commit 413, and never retries storage PUT 413', () => fixture(async store => {
  clearLearnedOpenDesignUploadLimits();
  clearReferenceEncoderCache();
  const big = await generateNoisyPng(store.directory, 'two-k.png', 1300, 1300, false);
  const big2 = await generateNoisyPng(store.directory, 'two-k-2.png', 1300, 1300, false);
  assert.ok(big.bytes.length > OPEN_DESIGN_LEGACY_UPLOAD_LIMIT_BYTES);
  assert.ok(big.bytes.length < OPEN_DESIGN_UPLOAD_SOFT_BUDGET_BYTES);

  const refs = [
    { file: big.file, mimeType: 'image/png', bytes: big.bytes.length },
    { file: big2.file, mimeType: 'image/png', bytes: big2.bytes.length },
  ];
  const progress = async () => {};
  const signal = new AbortController().signal;

  // 1. Upgraded AMR (30 MiB cap): sends original raw PNG untouched with zero compression.
  {
    const putSizes: number[] = [];
    const putMimes: string[] = [];
    const fetcher: Fetcher = (async (url, init = {}) => {
      const target = new URL(String(url));
      if (target.host === 'storage.example') {
        const body = init.body as Buffer;
        putSizes.push(body.length);
        putMimes.push(new Headers(init.headers).get('Content-Type') ?? '');
        return new Response(null, { status: 200 });
      }
      if (target.pathname.endsWith('/uploads')) {
        const body = JSON.parse(String(init.body));
        assert.equal(body.size_bytes, big.bytes.length);
        assert.equal(body.mime_type, 'image/png');
        return Response.json({ asset_id: `ma_raw_${putSizes.length}`, upload_url: 'https://storage.example/put' }, { status: 201 });
      }
      if (target.pathname.endsWith('/commit')) return Response.json({ status: 'ready' });
      throw new Error(`unexpected ${url}`);
    }) as Fetcher;

    const ids = await uploadInputs(fetcher, 'https://upgraded-amr.example/api/v1/media', { Authorization: 'Bearer k', 'Content-Type': 'application/json' }, 'job-raw', {
      references: [refs[0]],
      progress,
      signal,
    });
    assert.deepEqual(ids, ['ma_raw_0']);
    assert.deepEqual(putSizes, [big.bytes.length]);
    assert.deepEqual(putMimes, ['image/png']);
    assert.equal(getLearnedOpenDesignUploadLimit('https://upgraded-amr.example'), undefined);
  }

  // 2. Legacy AMR (2 MiB cap at /uploads): probes raw on ref 0 -> 413 -> compresses once with -compressed keys -> learns 2 MiB cap -> ref 1 compresses upfront with ZERO 413!
  {
    const uploadKeys: string[] = [];
    const commitKeys: string[] = [];
    let upload413Count = 0;
    let putCount = 0;
    const fetcher: Fetcher = (async (url, init = {}) => {
      const target = new URL(String(url));
      const reqHeaders = new Headers(init.headers);
      if (target.host === 'storage.example') {
        putCount++;
        const body = init.body as Buffer;
        assert.ok(body.length <= OPEN_DESIGN_LEGACY_UPLOAD_LIMIT_BYTES);
        assert.equal(detectReferenceImageMime(body), reqHeaders.get('Content-Type'));
        assert.equal(Number(reqHeaders.get('Content-Length')), body.length);
        return new Response(null, { status: 200 });
      }
      if (target.pathname.endsWith('/uploads')) {
        uploadKeys.push(reqHeaders.get('Idempotency-Key') ?? '');
        const body = JSON.parse(String(init.body));
        if (body.size_bytes > OPEN_DESIGN_LEGACY_UPLOAD_LIMIT_BYTES) {
          upload413Count++;
          return Response.json({ error: 'asset_too_large' }, { status: 413 });
        }
        return Response.json({ asset_id: `ma_leg_${putCount}`, upload_url: 'https://storage.example/put' }, { status: 201 });
      }
      if (target.pathname.endsWith('/commit')) {
        commitKeys.push(reqHeaders.get('Idempotency-Key') ?? '');
        return Response.json({ status: 'ready' });
      }
      throw new Error(`unexpected ${url}`);
    }) as Fetcher;

    const ids = await uploadInputs(fetcher, 'https://legacy-amr.example/api/v1/media', { Authorization: 'Bearer k', 'Content-Type': 'application/json' }, 'job-leg', {
      references: refs,
      progress,
      signal,
    });
    assert.deepEqual(ids, ['ma_leg_0', 'ma_leg_1']);
    assert.equal(upload413Count, 1, 'only the first reference should probe and receive 413; second must compress upfront from cache');
    assert.equal(putCount, 2, 'rejected raw declaration must never upload bytes to storage');
    assert.deepEqual(uploadKeys, ['job-leg-upload-0', 'job-leg-upload-0-compressed', 'job-leg-upload-1']);
    assert.deepEqual(commitKeys, ['job-leg-commit-0-compressed', 'job-leg-commit-1']);
    assert.equal(getLearnedOpenDesignUploadLimit('https://legacy-amr.example'), OPEN_DESIGN_LEGACY_UPLOAD_LIMIT_BYTES);
  }

  // 3. Mixed-rollout AMR: /uploads accepts >2 MiB, storage PUT succeeds, /commit returns 413 asset_too_large -> retries fresh upload with -compressed keys.
  {
    const uploadKeys: string[] = [];
    const commitKeys: string[] = [];
    const storedSizes = new Map<string, number>();
    let seq = 0;
    const fetcher: Fetcher = (async (url, init = {}) => {
      const target = new URL(String(url));
      const reqHeaders = new Headers(init.headers);
      if (target.host === 'storage.example') {
        const assetId = target.pathname.slice(1);
        storedSizes.set(assetId, (init.body as Buffer).length);
        return new Response(null, { status: 200 });
      }
      if (target.pathname.endsWith('/uploads')) {
        uploadKeys.push(reqHeaders.get('Idempotency-Key') ?? '');
        const id = `ma_mix_${seq++}`;
        return Response.json({ asset_id: id, upload_url: `https://storage.example/${id}` }, { status: 201 });
      }
      if (target.pathname.endsWith('/commit')) {
        commitKeys.push(reqHeaders.get('Idempotency-Key') ?? '');
        const assetId = target.pathname.split('/').at(-2)!;
        if ((storedSizes.get(assetId) ?? 0) > OPEN_DESIGN_LEGACY_UPLOAD_LIMIT_BYTES) {
          return Response.json({ error: 'asset_too_large' }, { status: 413 });
        }
        return Response.json({ status: 'ready' });
      }
      throw new Error(`unexpected ${url}`);
    }) as Fetcher;

    const ids = await uploadInputs(fetcher, 'https://mixed-amr.example/api/v1/media', { Authorization: 'Bearer k', 'Content-Type': 'application/json' }, 'job-mix', {
      references: [refs[0]],
      progress,
      signal,
    });
    assert.deepEqual(ids, ['ma_mix_1']);
    assert.deepEqual(uploadKeys, ['job-mix-upload-0', 'job-mix-upload-0-compressed']);
    assert.deepEqual(commitKeys, ['job-mix-commit-0', 'job-mix-commit-0-compressed']);
    assert.equal(getLearnedOpenDesignUploadLimit('https://mixed-amr.example'), OPEN_DESIGN_LEGACY_UPLOAD_LIMIT_BYTES);
  }

  // 4. Storage PUT 413 is NOT retried and does NOT poison the learned AMR limit.
  {
    let uploadCalls = 0;
    const fetcher: Fetcher = (async (url) => {
      const target = new URL(String(url));
      if (target.host === 'storage.example') return new Response(null, { status: 413 });
      if (target.pathname.endsWith('/uploads')) {
        uploadCalls++;
        return Response.json({ asset_id: 'ma_put_err', upload_url: 'https://storage.example/put' }, { status: 201 });
      }
      throw new Error(`unexpected ${url}`);
    }) as Fetcher;

    await assert.rejects(
      uploadInputs(fetcher, 'https://storage-413.example/api/v1/media', { Authorization: 'Bearer k', 'Content-Type': 'application/json' }, 'job-put', {
        references: [refs[0]],
        progress,
        signal,
      }),
      (err: unknown) => err instanceof Error && /storage HTTP 413/.test(err.message) && (err as { errorSource?: string }).errorSource === 'storage',
    );
    assert.equal(uploadCalls, 1);
    assert.equal(getLearnedOpenDesignUploadLimit('https://storage-413.example'), undefined);
  }

  // 5. Snapshot integrity check fires BEFORE compression or network calls.
  await assert.rejects(
    uploadInputs(
      (async () => { throw new Error('network must not be called'); }) as Fetcher,
      'https://integrity.example/api/v1/media',
      { Authorization: 'Bearer k', 'Content-Type': 'application/json' },
      'job-corrupt',
      {
        references: [{ file: big.file, mimeType: 'image/png', bytes: big.bytes.length - 10 }],
        progress,
        signal,
      },
    ),
    /Reference image changed after it was queued/,
  );
}));

test('account normalizeReferences sniffs magic bytes even when the file extension mismatches', () => fixture(async store => {
  clearLearnedOpenDesignUploadLimits();
  // Create a genuine JPEG saved under a misleading `.png` filename.
  const jpgPath = path.join(store.directory, 'mislabelled.jpg');
  const res = await execute(verificationBinaries().ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=32x32', '-frames:v', '1', '-y', jpgPath], store.directory, 15_000);
  assert.equal(res.code, 0, res.stderr);
  const jpegBytes = await readFile(jpgPath);
  const mislabelledPng = path.join(store.directory, 'mislabelled.png');
  await writeFile(mislabelledPng, jpegBytes);

  // Create a minimal signed-in account profile pointing at productionApi with a mock fetcher.
  const accountDir = path.join(store.directory, 'account');
  await mkdir(accountDir, { recursive: true });
  await writeFile(path.join(accountDir, 'session.json'), JSON.stringify({
    state: 'signed-in',
    id: 'acct-1',
    profile: {
      userId: 'u1',
      workspaceId: 'ws1',
      apiUrl: 'https://amr-api.open-design.ai',
      controlKey: 'ctrl-key',
      controlKeyId: 'ck-1',
      verifiedAt: Date.now(),
    },
  }));
  const declaredMimes: string[] = [];
  const putMimes: string[] = [];
  const fetcher: Fetcher = (async (url, init = {}) => {
    const target = new URL(String(url));
    if (target.host === 'storage.example') {
      putMimes.push(new Headers(init.headers).get('Content-Type') ?? '');
      return new Response(null, { status: 200 });
    }
    if (target.pathname.endsWith('/uploads')) {
      declaredMimes.push(JSON.parse(String(init.body)).mime_type);
      return Response.json({ asset_id: 'ma_sniff_1', upload_url: 'https://storage.example/put' }, { status: 201 });
    }
    if (target.pathname.endsWith('/commit')) return Response.json({ status: 'ready' });
    if (target.pathname.endsWith('/images/edits')) return Response.json({ task_id: 'img-task-1' }, { status: 202 });
    if (target.pathname.endsWith('/images/tasks/img-task-1')) return Response.json({
      task_id: 'img-task-1',
      model: 'gpt-image-2',
      status: 'succeeded',
      assets: [{ status: 'ready', asset_id: 'out-1', url: 'https://cdn.example/out.jpg', mime_type: 'image/jpeg', size_bytes: jpegBytes.length }],
    });
    throw new Error(`unexpected ${url}`);
  }) as Fetcher;

  const account = new OpenDesignAccount(store.directory, {
    pollMs: 1,
    fetcher,
    download: async () => new Response(jpegBytes, { status: 200, headers: { 'Content-Length': String(jpegBytes.length), ETag: '"e1"' } }),
  });
  await mkdir(account.home, { recursive: true });
  await writeFile(path.join(account.home, 'config.json'), JSON.stringify({
    profiles: {
      prod: {
        apiUrl: 'https://amr-api.open-design.ai',
        controlKey: 'ctrl-key',
        controlKeyId: 'ck-1',
        runtimeKey: 'rt-key',
        user: { id: 'u1', email: 'u1@example.com' },
        workspace: { id: 'ws1', name: 'Personal' },
      },
    },
  }));
  await writeFile(path.join(account.root, 'session.json'), JSON.stringify({ id: 'acct-1' }));

  const job: GenerationJob = {
    id: 'job-sniff',
    state: 'running',
    modality: 'image',
    prompt: 'relight',
    providerOrigin: 'acct-1',
    model: { id: 'account:gpt-image-2', provider: 'account', modelId: 'gpt-image-2', label: 'gpt-image-2', modality: 'image', mode: 'text-to-image', source: 'live', supportsImageReference: true, maxInputImages: 4 },
    parameters: {},
    createdAt: Date.now(),
    updatedAt: Date.now(),
    phase: 'uploading',
    assets: [],
  };
  await account.generate(job, store.directory, new AbortController().signal, async () => {}, mislabelledPng, []);
  assert.deepEqual(declaredMimes, ['image/jpeg']);
  assert.deepEqual(putMimes, ['image/jpeg']);
}));

test('opendesign-3d uses shared probe-then-compress upload and fails loudly instead of swallowing encoder errors', () => fixture(async store => {
  clearLearnedOpenDesignUploadLimits();
  clearOpenDesign3dDiscoveryCache();
  clearReferenceEncoderCache();

  const big = await generateNoisyPng(store.directory, 'tripo-big.png', 1300, 1300, false);
  const library = new AssetLibrary(store);
  const imported = await library.importFile(big.file, { requestId: 'tripo-big', name: 'Big 3D Ref' });

  const uploadKeys: string[] = [];
  const commitKeys: string[] = [];
  const putSizes: number[] = [];
  let seq = 0;

  // Build a minimal valid GLB 2 buffer for task download completion.
  const gltfJson = Buffer.from(JSON.stringify({ asset: { version: '2.0' } }));
  const pad = (4 - (gltfJson.length % 4)) % 4;
  const paddedJson = Buffer.concat([gltfJson, Buffer.alloc(pad, 0x20)]);
  const glb = Buffer.alloc(12 + 8 + paddedJson.length);
  glb.write('glTF', 0, 'ascii');
  glb.writeUInt32LE(2, 4);
  glb.writeUInt32LE(glb.length, 8);
  glb.writeUInt32LE(paddedJson.length, 12);
  glb.writeUInt32LE(0x4e4f534a, 16);
  paddedJson.copy(glb, 20);

  const gateway = gatewayFor(store);
  try {
    const fetcher: Fetcher = (async (url, init = {}) => {
      const target = new URL(String(url));
      const reqHeaders = new Headers(init.headers);
      if (target.host === 'storage-3d.example') {
        const body = Buffer.from(init.body as Uint8Array);
        putSizes.push(body.length);
        assert.ok(body.length <= OPEN_DESIGN_LEGACY_UPLOAD_LIMIT_BYTES);
        assert.equal(detectReferenceImageMime(body), reqHeaders.get('Content-Type'));
        return new Response(null, { status: 200 });
      }
      if (target.pathname.endsWith('/models')) {
        return Response.json({ models: [{ model: 'tripo-3.0', kind: '3d_generations', capabilities: {} }] });
      }
      if (target.pathname.endsWith('/uploads')) {
        uploadKeys.push(reqHeaders.get('Idempotency-Key') ?? '');
        const body = JSON.parse(String(init.body));
        if (body.size_bytes > OPEN_DESIGN_LEGACY_UPLOAD_LIMIT_BYTES) {
          return Response.json({ error: 'asset_too_large' }, { status: 413 });
        }
        return Response.json({ asset_id: `ma_3d_${seq++}`, upload_url: 'https://storage-3d.example/put' }, { status: 201 });
      }
      if (target.pathname.endsWith('/commit')) {
        commitKeys.push(reqHeaders.get('Idempotency-Key') ?? '');
        return Response.json({ status: 'ready' });
      }
      if (target.pathname.endsWith('/3d/tasks') && init.method === 'POST') {
        return Response.json({ task_id: 'tripo-task-1' }, { status: 202 });
      }
      if (target.pathname.endsWith('/3d/tasks/tripo-task-1')) {
        return Response.json({
          status: 'succeeded',
          artifacts: [{ name: 'model.glb', format: 'glb', url: 'https://cdn-3d.example/model.glb' }],
        });
      }
      if (target.host === 'cdn-3d.example') {
        return new Response(glb, { status: 200, headers: { 'Content-Type': 'model/gltf-binary' } });
      }
      throw new Error(`unexpected 3D URL ${url}`);
    }) as Fetcher;

    gateway.options.fetcher = fetcher;
    gateway.options.pollMs = 1;
    await gateway.configureProvider('opendesign', { apiKey: 'test-3d-key', baseUrl: 'https://tripo-legacy.example' });
    const output = await runOpenDesign3dScript({
      store,
      capability: { id: '3d-asset' } as any,
      requestId: 'req-3d-413-fallback',
      prompt: 'low poly mug',
      options: { operation: 'image_to_model' },
      parameters: {},
      references: [{ assetId: imported.id, versionId: imported.currentVersionId, filename: big.file, mimeType: 'image/png', modality: 'image' }],
    });
    assert.ok(output.sourcePath);
    await output.cleanup?.();
    assert.deepEqual(uploadKeys, ['req-3d-413-fallback-upload', 'req-3d-413-fallback-upload-compressed']);
    assert.deepEqual(commitKeys, ['req-3d-413-fallback-commit-compressed']);
    assert.equal(putSizes.length, 1);

    // When no encoder is available and origin requires compression, 3D must fail loudly (never swallow error).
    setReferenceEncoderCapabilitiesForTests({ cwebp: false, ffmpegLibwebp: false, ffmpegPng: false, ffmpegJpeg: false, sipsPng: false, sipsJpeg: false });
    await assert.rejects(
      runOpenDesign3dScript({
        store,
        capability: { id: '3d-asset' } as any,
        requestId: 'req-3d-no-encoder',
        prompt: 'low poly mug',
        options: { operation: 'image_to_model' },
        parameters: {},
        references: [{ assetId: imported.id, versionId: imported.currentVersionId, filename: big.file, mimeType: 'image/png', modality: 'image' }],
      }),
      (err: unknown) => err instanceof ReferencePreparationError && err.code === 'REFERENCE_ENCODER_UNAVAILABLE',
    );
  } finally {
    setReferenceEncoderCapabilitiesForTests(undefined);
    clearOpenDesign3dDiscoveryCache();
    await gateway.close();
  }
}));

test('telemetry classifies structured reference preparation and 413 upload errors without relying on 2 MiB text', () => {
  const tooLarge = new ReferencePreparationError('REFERENCE_TOO_LARGE', 'The reference image is larger than the 30 MiB OpenDesign limit.');
  assert.deepEqual(classifyRejectionError(tooLarge), { reason: 'REFERENCE_TOO_LARGE', category: 'reference_invalid' });
  assert.equal(mediaGenerationError(tooLarge, 'uploading'), 'INVALID_REQUEST');

  const noEncoder = new ReferencePreparationError('REFERENCE_ENCODER_UNAVAILABLE', 'Could not prepare the reference image for upload because no compatible local image encoder is available.');
  assert.deepEqual(classifyRejectionError(noEncoder), { reason: 'NATIVE_RUNTIME_MISSING', category: 'runtime_unavailable' });
  assert.equal(mediaGenerationError(noEncoder, 'uploading'), 'UPLOAD_FAILED');

  const api413 = new ProviderError('OpenDesign rejected this reference image because it exceeds the upload size limit.', 413, 'asset_too_large', 'api');
  assert.deepEqual(classifyRejectionError(api413), { reason: 'REFERENCE_TOO_LARGE', category: 'reference_invalid' });
  assert.equal(mediaGenerationError(api413, 'uploading'), 'INVALID_REQUEST');
});
