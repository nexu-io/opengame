import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { assetHash } from '../gateway/asset-library.ts';
import { fixture } from './fixtures.ts';
import { execute, pluginRoot } from '../hyperframes.ts';
import { verificationBinaries } from '../scripts/verify-export.ts';
import { Phase1Service } from '../phase1.ts';
import { OpenDesignAccount } from '../gateway/account.ts';
import { readCappedBytes } from '../gateway/network.ts';
import { productionApi } from '../gateway/opendesign.ts';
import { gatewayFor } from '../gateway/service.ts';
import { clearOpenDesign3dDiscoveryCache, normalizeTripoAnimation } from '../gateway/opendesign-3d.ts';
import {
  capabilityRun,
  registerCapabilityQuoteEstimator,
  registerCapabilityScriptExecutor,
  saveCapabilityOverrides,
  setCapabilityRemoteConfigFetcher,
  syncCapabilityRemoteConfig,
  unregisterCapabilityScriptExecutor,
} from '../gateway/capability-center.ts';
import {
  buildCapabilityParameters,
  buildCapabilityPrompt,
  capabilityControlSchema,
  defaultCapabilities,
  findCapability,
  resolveCapabilityCatalog,
  resolveCapabilityOptions,
} from '../shared/capability-registry.ts';
import { findLandingScene } from '../shared/studio-catalog.ts';
import { isStandaloneSpaPath } from '../shared/spa-routes.ts';
import { imageFeatures, imageFeaturePrompt } from '../shared/image-features.ts';
import { videoFeatures, videoFeaturePrompt } from '../shared/video-features.ts';
import { generationOptions } from '../shared/generation-options.ts';

const service = (store: any) =>
  new Phase1Service(store, pluginRoot, {
    origin: () => 'http://localhost:4173',
    nativeUrl: () => undefined,
    openProject: async () => {},
    mutation: async task => task(),
    cancel: async () => {},
  });

async function makePng(directory: string, filename: string, color: string) {
  const file = path.join(directory, filename);
  const result = await execute(
    verificationBinaries().ffmpeg,
    ['-v', 'error', '-f', 'lavfi', '-i', `color=c=${color}:s=32x24`, '-frames:v', '1', '-y', file],
    directory,
    20_000,
  );
  assert.equal(result.code, 0, result.stderr);
  return file;
}

test('Unified Capability Registry drives shared image/video features and separates live vs coming-soon capabilities', () => {
  assert.deepEqual(imageFeatures['remove-background'].parameters, { background: 'transparent' });
  assert.equal(imageFeatures.relight.recommended, 'seedream-5.5');
  assert.equal(videoFeatures['multi-shot'].defaultDuration, 10);
  const nativeAudio = findCapability('native-audio');
  assert.ok(nativeAudio && nativeAudio.executor.kind === 'prompt-preset' && nativeAudio.executor.forceAudio === true);
  assert.equal(nativeAudio.channels.gui, false);
  assert.equal(nativeAudio.channels.mcp, true);
  assert.match(imageFeaturePrompt('relight', 'Sharp rim.', { direction: 'back', temperature: 'warm', mood: 'neon' }), /backlight.*3200K.*neon/i);
  assert.match(videoFeaturePrompt('camera-control', 'Mountain peak', { movement: 'orbit', pace: 'slow' }), /360-degree camera orbit.*Mountain peak/);

  assert.equal(defaultCapabilities.length, 35);
  const liveIds = defaultCapabilities.filter(c => c.status === 'live').map(c => c.id);
  assert.equal(liveIds.length, 17);
  for (const id of ['text-to-image', 'remove-background', 'image-blend', 'relight', 'camera-control', 'multi-shot', 'native-audio', 'music', 'sound-effects', 'speech', 'asr-transcribe', '3d-asset', '3d-world']) {
    assert.ok(liveIds.includes(id), `expected live capability ${id}`);
  }
  const deprecatedCharacter = defaultCapabilities.find(c => c.id === 'character');
  assert.equal(deprecatedCharacter?.status, 'deprecated');
  assert.equal(deprecatedCharacter?.replacementCapabilityId, 'image-blend');
  assert.equal(liveIds.includes('character'), false);
  const soonIds = defaultCapabilities.filter(c => c.status === 'coming_soon').map(c => c.id);
  assert.equal(soonIds.length, 17);
  for (const id of ['inpainting', 'expand-image', 'upscale-4k', 'omni-reference', 'lipsync', 'voice-changer', 'dubbing', 'digital-human']) {
    assert.ok(soonIds.includes(id), `expected coming_soon capability ${id}`);
  }
});

test('4 MCP meta-tools discover schemas, execute capabilities, manage jobs and persist capability provenance on AssetVersion', () =>
  fixture(async store => {
    const api = service(store);
    const gateway = gatewayFor(store);
    gateway.options.detect = async () => [
      { id: 'codex', label: 'Codex', installed: true, authenticated: true, imageGeneration: true, available: true, reason: 'fixture' },
    ];
    gateway.options.codex = async () => readFile(await makePng(store.directory, 'generated.png', 'teal'));

    // 1. Discover live MCP capabilities (coming_soon excluded by default)
    const listed = await api.call('openmotion_capability_discover', { action: 'list' });
    assert.ok(listed.capabilities.some((c: any) => c.id === 'text-to-image' && c.available === true));
    assert.ok(listed.capabilities.some((c: any) => c.id === 'remove-background'));
    assert.ok(!listed.capabilities.some((c: any) => c.status === 'coming_soon'));

    const withSoon = await api.call('openmotion_capability_discover', { action: 'list', includeComingSoon: true });
    assert.ok(withSoon.capabilities.some((c: any) => c.id === 'lipsync' && c.status === 'coming_soon'));

    // 2. Describe capability options schema
    const relightMeta = await api.call('openmotion_capability_discover', { action: 'describe', capabilityId: 'relight' });
    assert.equal(relightMeta.capability.id, 'relight');
    assert.equal(relightMeta.capability.input.minReferences, 1);
    assert.deepEqual(relightMeta.capability.input.optionsSchema.properties.direction.enum, ['left', 'right', 'front', 'top', 'back']);

    // 3. Reject coming_soon capability execution cleanly
    await assert.rejects(
      api.call('openmotion_capability_run', { action: 'run', requestId: 'soon-1', capabilityId: 'lipsync' }),
      /CAPABILITY_COMING_SOON/,
    );

    // 4. Execute text-to-image through capability_run, poll via job_manage, inspect provenance via asset_manage
    const submitted = await api.call('openmotion_capability_run', {
      action: 'run',
      requestId: 'cap-t2i-1',
      capabilityId: 'text-to-image',
      prompt: 'Minimal ceramic mug',
      name: 'Ceramic Mug',
    });
    assert.equal(submitted.capabilityId, 'text-to-image');
    assert.equal(submitted.selectedModel, 'codex:image-generation');
    assert.equal(submitted.next.tool, 'openmotion_job_manage');

    // Idempotent replay with same requestId returns the exact same job without re-running
    const replayed = await api.call('openmotion_capability_run', {
      action: 'run',
      requestId: 'cap-t2i-1',
      capabilityId: 'text-to-image',
      prompt: 'Minimal ceramic mug',
      name: 'Ceramic Mug',
    });
    assert.equal(replayed.job.id, submitted.job.id);

    await gateway.tick();
    await Promise.all([...gateway.active.values()].map(task => task.done));

    const jobState = await api.call('openmotion_job_manage', { action: 'status', jobId: submitted.job.id });
    assert.equal(jobState.job.state, 'completed');
    assert.equal(jobState.job.capabilityId, 'text-to-image');
    const createdRef = jobState.job.libraryAssets[0];
    assert.ok(createdRef?.assetId && createdRef?.versionId);

    const inspected = await api.call('openmotion_asset_manage', {
      action: 'get',
      assetId: createdRef.assetId,
      versionId: createdRef.versionId,
    });
    assert.equal(inspected.version.capabilityId, 'text-to-image');
    assert.equal(inspected.asset.name, 'Ceramic Mug');

    const preview = await api.call('openmotion_asset_manage', {
      action: 'read',
      assetId: createdRef.assetId,
      versionId: createdRef.versionId,
    });
    assert.equal(preview.versionId, createdRef.versionId);
    assert.ok(preview.content.some((block: any) => block.type === 'image'));
  }, false));

test('Unified Capability Center supports runtime hot-swapping to a local script executor and two-step soft deprecation', () =>
  fixture(async store => {
    const api = service(store);
    const scriptId = 'test-fast-matting-v1';

    // Import an initial source image asset
    const sourcePng = await makePng(store.directory, 'product-raw.png', 'orange');
    const imported = await api.call('openmotion_asset_manage', {
      action: 'import',
      requestId: 'import-raw-1',
      sourcePath: sourcePng,
      name: 'Raw Product',
    });
    const ref = { assetId: imported.asset.id, versionId: imported.asset.currentVersionId };

    registerCapabilityScriptExecutor(scriptId, async ctx => {
      assert.equal(ctx.references.length, 1);
      assert.equal(ctx.references[0].assetId, ref.assetId);
      const cutout = await makePng(store.directory, 'cutout.png', 'white');
      return { sourcePath: cutout, name: 'Cutout Product' };
    });

    try {
      // Hot-swap `remove-background` to the script executor AND soft-deprecate `relight` -> `image-edit`
      await saveCapabilityOverrides(store, [
        {
          id: 'remove-background',
          executor: { kind: 'script', scriptId },
        },
        {
          id: 'relight',
          status: 'deprecated',
          replacementCapabilityId: 'image-edit',
        },
      ]);

      // 1. Deprecated `relight` immediately disappears from active discovery list
      const discovered = await api.call('openmotion_capability_discover', { action: 'list' });
      assert.ok(!discovered.capabilities.some((c: any) => c.id === 'relight'));
      const rmBg = discovered.capabilities.find((c: any) => c.id === 'remove-background');
      assert.ok(rmBg);
      assert.equal(rmBg.executorKind, 'script');
      assert.equal(rmBg.available, true);

      // 2. Calling deprecated `relight` returns actionable replacement guidance
      await assert.rejects(
        api.call('openmotion_capability_run', {
          action: 'run',
          requestId: 'dep-relight-1',
          capabilityId: 'relight',
          references: [ref],
        }),
        /CAPABILITY_DEPRECATED: relight is no longer active; use image-edit instead/,
      );

      // 3. Calling hot-swapped `remove-background` runs the script and creates a linked v2 on the same asset
      const executed = await api.call('openmotion_capability_run', {
        action: 'run',
        requestId: 'script-rmbg-1',
        capabilityId: 'remove-background',
        assetId: imported.asset.id,
        parentVersionId: imported.asset.currentVersionId,
        references: [ref],
      });
      assert.equal(executed.executorKind, 'script');
      assert.equal(executed.version.capabilityId, 'remove-background');
      assert.equal(executed.version.parentVersionId, ref.versionId);
      assert.deepEqual(executed.version.references, [ref]);
      assert.equal(executed.asset.versions.length, 2);

      // 4. Standalone script execution deduplicates by requestId and rejects input conflicts
      const standalone = await api.call('openmotion_capability_run', {
        action: 'run',
        requestId: 'script-standalone-1',
        capabilityId: 'remove-background',
        references: [ref],
      });
      const standaloneReplay = await api.call('openmotion_capability_run', {
        action: 'run',
        requestId: 'script-standalone-1',
        capabilityId: 'remove-background',
        references: [ref],
      });
      assert.equal(standaloneReplay.asset.id, standalone.asset.id);
      assert.equal(standaloneReplay.version.id, standalone.version.id);
      await assert.rejects(
        api.call('openmotion_capability_run', {
          action: 'run',
          requestId: 'script-standalone-1',
          capabilityId: 'remove-background',
          prompt: 'Different note',
          references: [ref],
        }),
        /REQUEST_ID_CONFLICT/,
      );
    } finally {
      unregisterCapabilityScriptExecutor(scriptId);
    }
  }, false));

test('extension hooks cover dedicated-model structured parameter mapping, remote hot-config sync, spend quotes, and on-demand Library Skills', () =>
  fixture(async store => {
    const api = service(store);
    const gateway = gatewayFor(store);
    gateway.options.detect = async () => [
      { id: 'codex', label: 'Codex', installed: true, authenticated: true, imageGeneration: true, available: true, reason: 'fixture' },
    ];

    try {
      // 1. Remote hot-config lights up `upscale-4k` as a `dedicated-model` with optionToParameter mapping
      setCapabilityRemoteConfigFetcher(async () => [
        {
          id: 'upscale-4k',
          status: 'live',
          channels: { gui: true, mcp: true },
          costTier: 'high',
          requiresExplicitApproval: true,
          executor: {
            kind: 'dedicated-model',
            providers: ['codex'],
            models: ['image-generation'],
            recommendedModel: 'image-generation',
            mode: 'text-to-image',
            defaultParameters: { format: 'png' },
            optionToParameter: { scale: 'upscale_factor' },
          },
        },
      ]);
      await syncCapabilityRemoteConfig(store);

      // 2. Custom cloud quote estimator plugs into both `action=quote` and `dryRun=true`
      registerCapabilityQuoteEstimator(async ({ capability, modality, options, model }) => ({
        capabilityId: capability?.id ?? 'raw-model',
        costTier: capability?.costTier ?? (modality === 'video' ? 'medium' : 'low'),
        requiresExplicitApproval: capability?.requiresExplicitApproval ?? modality === 'video',
        estimatedCredits: capability ? (options.scale === '4x' ? 12 : 6) : 3,
        currency: 'credits',
        quoteSource: 'cloud-quote',
        selectedModel: model?.id ?? null,
      }));

      const quoted = await api.call('openmotion_capability_discover', {
        action: 'quote',
        capabilityId: 'upscale-4k',
        options: { scale: '4x' },
      });
      assert.equal(quoted.quote.quoteSource, 'cloud-quote');
      assert.equal(quoted.quote.estimatedCredits, 12);
      assert.equal(quoted.quote.requiresExplicitApproval, true);

      const sourcePng = await makePng(store.directory, 'lowres.png', 'navy');
      const imported = await api.call('openmotion_asset_manage', {
        action: 'import',
        requestId: 'import-lowres-1',
        sourcePath: sourcePng,
        name: 'Lowres Shot',
      });
      const ref = { assetId: imported.asset.id, versionId: imported.asset.currentVersionId };

      const dryRun = await api.call('openmotion_capability_run', {
        action: 'run',
        requestId: 'dry-upscale-1',
        capabilityId: 'upscale-4k',
        options: { scale: '4x' },
        references: [ref],
        dryRun: true,
      });
      assert.equal(dryRun.dryRun, true);
      assert.equal(dryRun.executorKind, 'dedicated-model');
      assert.deepEqual(dryRun.effectiveParameters, { format: 'png', upscale_factor: '4x' });
      assert.equal(dryRun.quote.estimatedCredits, 12);
    } finally {
      setCapabilityRemoteConfigFetcher(undefined);
      registerCapabilityQuoteEstimator(undefined);
    }

    // 3. Progressive-disclosure Library Skills for digital-human & video-dubbing are indexed and readable
    const skillIndex = await api.call('openmotion_list_skills', {});
    const rows = (await readFile(skillIndex.indexPath, 'utf8'))
      .trim()
      .split('\n')
      .map(line => JSON.parse(line));
    for (const id of ['openmotion-digital-human-presenter', 'openmotion-video-dubbing']) {
      assert.ok(rows.some(row => row.skillId === id), `missing library skill ${id}`);
      const detail = await api.call('openmotion_get_skill', { skillId: id });
      assert.match(detail.instructions, /openmotion_capability_discover/);
    }
  }, false));

test('dryRun blocks paid submission across raw model, unavailable explicit model, and ASR service paths; discover list validates pagination', () =>
  fixture(async store => {
    const api = service(store);
    const gateway = gatewayFor(store);
    let codexInvocations = 0;
    gateway.options.detect = async () => [
      { id: 'codex', label: 'Codex', installed: true, authenticated: true, imageGeneration: true, available: true, reason: 'fixture' },
    ];
    gateway.options.codex = async () => {
      codexInvocations += 1;
      return readFile(await makePng(store.directory, 'should-not-run.png', 'red'));
    };

    try {
      // 1. Raw model fallback dryRun (no capabilityId, no requestId) must NEVER submit a job
      registerCapabilityQuoteEstimator(async ({ capability, modality, model }) => ({
        capabilityId: capability?.id ?? 'raw-model',
        costTier: modality === 'video' ? 'medium' : 'low',
        requiresExplicitApproval: modality === 'video',
        estimatedCredits: 4,
        currency: 'credits',
        quoteSource: 'cloud-quote',
        selectedModel: model?.id ?? null,
      }));

      const rawDry = await api.call('openmotion_capability_run', {
        model: 'codex:image-generation',
        modality: 'image',
        prompt: 'A quiet paper lantern at dusk',
        dryRun: true,
      });
      assert.equal(rawDry.dryRun, true);
      assert.equal(rawDry.executorKind, 'model');
      assert.equal(rawDry.selectedModel, 'codex:image-generation');
      assert.equal(rawDry.quote.quoteSource, 'cloud-quote');
      assert.equal(rawDry.quote.estimatedCredits, 4);
      assert.equal(codexInvocations, 0);
      assert.equal((await gateway.listJobs()).length, 0);

      // 2. Raw model fallback rejects mismatched modality and unavailable providers on dryRun
      await assert.rejects(
        api.call('openmotion_capability_run', {
          model: 'codex:image-generation',
          modality: 'video',
          prompt: 'Mismatched modality',
          dryRun: true,
        }),
        /CAPABILITY_MODEL_INCOMPATIBLE/,
      );
      await assert.rejects(
        api.call('openmotion_capability_run', {
          model: 'fal:flux-pro',
          modality: 'image',
          prompt: 'Unconfigured provider',
          dryRun: true,
        }),
        /CAPABILITY_UNAVAILABLE/,
      );

      // 3. Explicit args.model for a capability cannot bypass provider availability on dryRun
      await assert.rejects(
        api.call('openmotion_capability_run', {
          capabilityId: 'remove-background',
          model: 'opendesign:gpt-image-2.6-sunburst',
          references: [{ assetId: '00000000-0000-4000-8000-000000000001', versionId: '00000000-0000-4000-8000-000000000002' }],
          dryRun: true,
        }),
        /CAPABILITY_UNAVAILABLE|CAPABILITY_MODEL_INCOMPATIBLE/,
      );

      // 4. Service executor (asr-transcribe) validates ASR availability and language format during dryRun
      await assert.rejects(
        api.call('openmotion_capability_run', {
          capabilityId: 'asr-transcribe',
          sourcePath: 'sample.wav',
          language: 'not-a-code',
          dryRun: true,
        }),
        /ISO language code/,
      );
      await assert.rejects(
        api.call('openmotion_capability_run', {
          capabilityId: 'asr-transcribe',
          sourcePath: 'sample.wav',
          language: 'en',
          dryRun: true,
        }),
        /CAPABILITY_UNAVAILABLE/,
      );

      // 5. capabilityDiscover(action="list") supports offset/limit pagination and rejects invalid bounds
      const full = await api.call('openmotion_capability_discover', { action: 'list' });
      assert.equal(full.offset, 0);
      assert.equal(full.hasMore, false);
      assert.equal(full.capabilities.length, full.total);

      const page = await api.call('openmotion_capability_discover', { action: 'list', offset: 2, limit: 3 });
      assert.equal(page.total, full.total);
      assert.equal(page.offset, 2);
      assert.equal(page.limit, 3);
      assert.equal(page.capabilities.length, 3);
      assert.equal(page.hasMore, 2 + 3 < full.total);
      assert.deepEqual(
        page.capabilities.map((c: any) => c.id),
        full.capabilities.slice(2, 5).map((c: any) => c.id),
      );

      const pastEnd = await api.call('openmotion_capability_discover', { action: 'list', offset: 99, limit: 5 });
      assert.deepEqual(pastEnd.capabilities, []);
      assert.equal(pastEnd.total, full.total);
      assert.equal(pastEnd.hasMore, false);

      await assert.rejects(
        api.call('openmotion_capability_discover', { action: 'list', offset: -1 }),
        /offset|minimum/i,
      );
      await assert.rejects(
        api.call('openmotion_capability_discover', { action: 'list', limit: 0 }),
        /limit|minimum/i,
      );
    } finally {
      registerCapabilityQuoteEstimator(undefined);
    }
  }, false));

test('Studio assetOperation(generate) enforces capability preflight, findLandingScene excludes coming_soon, and multi-shot defaults to 3 shots', () =>
  fixture(async store => {
    // 1. multi-shot preserves defaultValue: '3' in schema and prompt builder
    const multiShot = findCapability('multi-shot')!;
    const schema = capabilityControlSchema(multiShot) as { properties: Record<string, { default?: string }> };
    assert.equal(schema.properties.shots.default, '3');
    assert.match(buildCapabilityPrompt('multi-shot', 'A lunar rover', {}), /a cohesive 3-shot narrative sequence/);

    // 2. findLandingScene and isStandaloneSpaPath exclude coming_soon capabilities by default and admit live overrides
    assert.equal(findLandingScene('inpainting'), undefined);
    assert.equal(findLandingScene('upscale-4k'), undefined);
    assert.equal(isStandaloneSpaPath('/create/inpainting'), false);
    assert.equal(isStandaloneSpaPath('/create/upscale-4k'), false);
    const withLiveUpscale = resolveCapabilityCatalog([
      { id: 'upscale-4k', status: 'live', channels: { gui: true, mcp: true } },
    ]);
    const liveScene = findLandingScene('upscale-4k', withLiveUpscale);
    assert.equal(liveScene?.id, 'upscale-4k');
    assert.equal(liveScene?.modality, 'image');
    assert.equal(isStandaloneSpaPath('/create/upscale-4k', '', '', withLiveUpscale), true);
    assert.equal(isStandaloneSpaPath('/create/inpainting', '', '', withLiveUpscale), false);

    // 3. openmotion_assets_use(action="generate") executes full capability preflight before gateway.submit
    const gateway = gatewayFor(store);
    let submitCalls = 0;
    const origSubmit = gateway.submit.bind(gateway);
    gateway.submit = (async (...args: Parameters<typeof gateway.submit>) => {
      submitCalls += 1;
      return origSubmit(...args);
    }) as typeof gateway.submit;

    (gateway as any).options.detect = async () => [
      { id: 'codex', label: 'Codex', installed: true, authenticated: true, imageGeneration: true, available: true, reason: 'fixture' },
    ];
    (gateway as any).models = async () => [
      { id: 'codex:image-generation', provider: 'codex', modelId: 'image-generation', label: 'Codex Image', modality: 'image', source: 'builtin', mode: 'text-to-image', supportsImageReference: true, maxInputImages: 5 },
      { id: 'opendesign:gpt-image-2.6-sunburst', provider: 'opendesign', modelId: 'gpt-image-2.6-sunburst', label: 'Sunburst', modality: 'image', source: 'live', mode: 'text-to-image', supportsImageReference: true, maxInputImages: 16, generationOptions: { delivery: 'provider', fields: [{ key: 'background', label: 'Background', kind: 'choice', choices: [{ value: 'transparent', label: 'Transparent' }] }] } },
    ];

    const api = service(store);
    const ref1 = { assetId: '00000000-0000-4000-8000-000000000001', versionId: '00000000-0000-4000-8000-000000000002' };
    const ref2 = { assetId: '00000000-0000-4000-8000-000000000003', versionId: '00000000-0000-4000-8000-000000000004' };

    try {
      // 3a. coming_soon capability rejected before submit
      await assert.rejects(
        api.call('openmotion_assets_use', {
          action: 'generate',
          requestId: 'preflight-soon',
          modality: 'image',
          model: 'codex:image-generation',
          prompt: 'Inpaint sky',
          capabilityId: 'inpainting',
          references: [ref1],
        }),
        /CAPABILITY_COMING_SOON/,
      );

      // 3b. Channel enforcement distinguishes GUI vs MCP callers
      // shot-image is live with channels: { gui: false, mcp: true }: rejected on GUI, accepted on MCP
      await assert.rejects(
        api.call(
          'openmotion_assets_use',
          {
            action: 'generate',
            requestId: 'preflight-channel-gui',
            modality: 'image',
            model: 'codex:image-generation',
            prompt: 'First frame',
            capabilityId: 'shot-image',
          },
          undefined,
          { channel: 'gui' },
        ),
        /CAPABILITY_CHANNEL_DISABLED/,
      );
      await saveCapabilityOverrides(store, [
        { id: 'expand-image', status: 'live', channels: { gui: true, mcp: false } },
      ]);
      // expand-image overridden to GUI-only: rejected on MCP channel
      await assert.rejects(
        api.call('openmotion_assets_use', {
          action: 'generate',
          requestId: 'preflight-channel-mcp',
          modality: 'image',
          model: 'codex:image-generation',
          prompt: 'Expand borders',
          capabilityId: 'expand-image',
          references: [ref1],
        }),
        /CAPABILITY_CHANNEL_DISABLED/,
      );

      // 3c. Live script override rejected with CAPABILITY_EXECUTOR_UNSUPPORTED instead of running generic model
      await saveCapabilityOverrides(store, [
        { id: 'remove-background', status: 'live', channels: { gui: true, mcp: true }, executor: { kind: 'script', scriptId: 'local-rmbg' } },
        { id: 'upscale-4k', status: 'live', channels: { gui: true, mcp: true }, executor: { kind: 'dedicated-model', providers: ['codex'], models: ['real-esrgan-4k'], recommendedModel: 'real-esrgan-4k', mode: 'text-to-image' } },
      ]);
      await assert.rejects(
        api.call('openmotion_assets_use', {
          action: 'generate',
          requestId: 'preflight-script',
          modality: 'image',
          model: 'codex:image-generation',
          prompt: 'Cut out subject',
          capabilityId: 'remove-background',
          references: [ref1],
        }),
        /CAPABILITY_EXECUTOR_UNSUPPORTED/,
      );

      // 3d. Live dedicated-model override rejects incompatible generic model and out-of-range references
      await assert.rejects(
        api.call('openmotion_assets_use', {
          action: 'generate',
          requestId: 'preflight-refs',
          modality: 'image',
          model: 'codex:image-generation',
          prompt: 'Upscale',
          capabilityId: 'upscale-4k',
          references: [ref1, ref2],
        }),
        /references|out_of_range|0\.\.|1\.\.1/i,
      );
      await assert.rejects(
        api.call('openmotion_assets_use', {
          action: 'generate',
          requestId: 'preflight-model',
          modality: 'image',
          model: 'codex:image-generation',
          prompt: 'Upscale',
          capabilityId: 'upscale-4k',
          references: [ref1],
        }),
        /CAPABILITY_MODEL_INCOMPATIBLE/,
      );

      // 3e. Invalid capabilityOptions rejected before submit
      await assert.rejects(
        api.call('openmotion_assets_use', {
          action: 'generate',
          requestId: 'preflight-opt',
          modality: 'image',
          model: 'codex:image-generation',
          prompt: 'Relight',
          capabilityId: 'relight',
          capabilityOptions: { direction: 'nonexistent-angle' },
          references: [ref1],
        }),
        /invalid choice|invalid_enum/i,
      );

      assert.equal(submitCalls, 0, 'gateway.submit must never be invoked when capability preflight fails');

      // 3f. MCP-only live capability (shot-image) succeeds on default MCP channel
      const origRun = gateway.submit.bind(gateway);
      gateway.submit = (async (input: any) => {
        submitCalls += 1;
        return { id: '00000000-0000-4000-8000-000000000099', state: 'queued', modality: input.modality, capabilityId: input.capabilityId };
      }) as typeof gateway.submit;
      const mcpAccepted = await api.call('openmotion_assets_use', {
        action: 'generate',
        requestId: 'preflight-mcp-shot-image',
        modality: 'image',
        model: 'codex:image-generation',
        prompt: 'Opening shot frame',
        capabilityId: 'shot-image',
      });
      assert.equal(mcpAccepted.job.capabilityId, 'shot-image');
      assert.equal(submitCalls, 1);
      void origRun;
    } finally {
      gateway.submit = origSubmit;
    }
  }, false));

test('concurrent script requestId reservation, capability dryRun parameter validation, and default control option mapping', () =>
  fixture(async store => {
    const root = store.directory;
    const sampleImage = path.join(root, 'concurrent-sample.png');
    const api = service(store);
    const { writeFile } = await import('node:fs/promises');
    const tinyPng = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7+8X8AAAAASUVORK5CYII=',
      'base64',
    );
    await writeFile(sampleImage, tinyPng);

    // 1. Concurrent script requests share one execution and conflict on differing inputs
    let handlerCalls = 0;
    let releaseGate!: () => void;
    let enteredGate!: () => void;
    const gateEntered = new Promise<void>(resolve => { enteredGate = resolve; });
    const gate = new Promise<void>(resolve => { releaseGate = resolve; });

    registerCapabilityScriptExecutor('test-concurrent-script', async () => {
      handlerCalls += 1;
      enteredGate();
      await gate;
      const outPath = path.join(root, `concurrent-out-${handlerCalls}.png`);
      await writeFile(outPath, tinyPng);
      return { sourcePath: outPath, name: 'Concurrent Output' };
    });

    let failOnce = true;
    registerCapabilityScriptExecutor('test-retry-script', async () => {
      if (failOnce) {
        failOnce = false;
        throw new Error('TRANSIENT_SCRIPT_FAILURE');
      }
      const outPath = path.join(root, 'retry-out.png');
      await writeFile(outPath, tinyPng);
      return { sourcePath: outPath, name: 'Retry Output' };
    });

    const gateway = gatewayFor(store);
    let submitCalls = 0;
    const origSubmit = gateway.submit.bind(gateway);
    gateway.submit = (async (...args: Parameters<typeof gateway.submit>) => {
      submitCalls += 1;
      return origSubmit(...args);
    }) as typeof gateway.submit;
    (gateway as any).options.detect = async () => [
      { id: 'codex', label: 'Codex', installed: true, authenticated: true, imageGeneration: true, available: true, reason: 'fixture' },
    ];
    (gateway as any).models = async () => [
      { id: 'codex:image-generation', provider: 'codex', modelId: 'image-generation', label: 'Codex Image', modality: 'image', source: 'builtin', mode: 'text-to-image', supportsImageReference: true, maxInputImages: 5 },
      { id: 'codex:real-esrgan-4k', provider: 'codex', modelId: 'real-esrgan-4k', label: 'Real-ESRGAN 4K', modality: 'image', source: 'live', mode: 'text-to-image', supportsImageReference: true, maxInputImages: 1 },
    ];

    try {
      await saveCapabilityOverrides(store, [
        {
          id: 'remove-background',
          status: 'live',
          channels: { gui: true, mcp: true },
          executor: { kind: 'script', scriptId: 'test-concurrent-script' },
          input: { promptRequired: false, minReferences: 0, maxReferences: 1 },
        },
        {
          id: 'expand-image',
          status: 'live',
          channels: { gui: true, mcp: true },
          executor: { kind: 'script', scriptId: 'test-retry-script' },
          input: { promptRequired: false, minReferences: 0, maxReferences: 1 },
        },
        {
          id: 'upscale-4k',
          status: 'live',
          channels: { gui: true, mcp: true },
          executor: {
            kind: 'dedicated-model',
            providers: ['codex'],
            models: ['real-esrgan-4k'],
            recommendedModel: 'real-esrgan-4k',
            mode: 'text-to-image',
            optionToParameter: { scale: 'upscale_factor' },
            defaultParameters: { face_enhance: false },
          },
        },
      ]);

      const firstPromise = capabilityRun(store, {
        capabilityId: 'remove-background',
        requestId: 'script-concurrent-req-1',
        prompt: 'Cut out subject',
      });
      await gateEntered;

      // Concurrent identical call waits on the reserved execution; conflicting input rejects immediately
      const secondPromise = capabilityRun(store, {
        capabilityId: 'remove-background',
        requestId: 'script-concurrent-req-1',
        prompt: 'Cut out subject',
      });
      await assert.rejects(
        capabilityRun(store, {
          capabilityId: 'remove-background',
          requestId: 'script-concurrent-req-1',
          prompt: 'Different conflicting prompt',
        }),
        /REQUEST_ID_CONFLICT/,
      );

      releaseGate();
      const [first, second] = await Promise.all([firstPromise, secondPromise]);
      assert.equal(handlerCalls, 1, 'concurrent identical script calls must invoke handler exactly once');
      assert.equal(first.asset.id, second.asset.id);
      assert.equal(first.version.id, second.version.id);
      assert.equal(Boolean(first.replayed || second.replayed), true);

      // Failed script execution releases pending receipt so the same requestId can be retried cleanly
      await assert.rejects(
        capabilityRun(store, {
          capabilityId: 'expand-image',
          requestId: 'script-retry-req-1',
          prompt: 'Retry me',
        }),
        /TRANSIENT_SCRIPT_FAILURE/,
      );
      const retried = await capabilityRun(store, {
        capabilityId: 'expand-image',
        requestId: 'script-retry-req-1',
        prompt: 'Retry me',
      });
      assert.equal(retried.executorKind, 'script');
      assert.ok(retried.asset.id);

      // 2. Registered-capability dryRun validates model parameters and mode just like real submission
      await assert.rejects(
        api.call('openmotion_capability_run', {
          capabilityId: 'text-to-image',
          model: 'codex:image-generation',
          prompt: 'Poster',
          parameters: { aspect_ratio: '99:1' },
          dryRun: true,
        }),
        /Invalid Aspect ratio: aspect_ratio/,
      );
      const validDryRun = await api.call('openmotion_capability_run', {
        capabilityId: 'text-to-image',
        model: 'codex:image-generation',
        prompt: 'Poster',
        parameters: { aspect_ratio: '16:9' },
        dryRun: true,
      });
      assert.equal(validDryRun.dryRun, true);
      assert.equal(validDryRun.effectiveParameters.aspect_ratio, '16:9');

      // 3. Dedicated-model option mapping applies control defaults when options are omitted
      const imported = await api.call('openmotion_asset_manage', {
        action: 'import',
        requestId: 'import-upscale-src',
        sourcePath: sampleImage,
        name: 'Upscale Src',
      });
      const srcRef = { assetId: imported.asset.id, versionId: imported.asset.currentVersionId };
      const liveCatalog = resolveCapabilityCatalog([
        {
          id: 'upscale-4k',
          status: 'live',
          channels: { gui: true, mcp: true },
          executor: {
            kind: 'dedicated-model',
            providers: ['codex'],
            models: ['real-esrgan-4k'],
            recommendedModel: 'real-esrgan-4k',
            mode: 'text-to-image',
            optionToParameter: { scale: 'upscale_factor' },
            defaultParameters: { face_enhance: false },
          },
        },
      ]);
      const upscaleCap = findCapability('upscale-4k', liveCatalog)!;
      assert.deepEqual(resolveCapabilityOptions(upscaleCap, {}), { scale: '4x' });
      assert.deepEqual(buildCapabilityParameters(upscaleCap, {}), { face_enhance: false, upscale_factor: '4x' });

      const upscaleDryRun = await api.call('openmotion_capability_run', {
        capabilityId: 'upscale-4k',
        references: [srcRef],
        dryRun: true,
      });
      assert.equal(upscaleDryRun.dryRun, true);
      assert.equal(upscaleDryRun.effectiveParameters.upscale_factor, '4x');
      assert.equal(upscaleDryRun.effectiveParameters.face_enhance, false);

      let capturedOptions: Record<string, unknown> | undefined;
      registerCapabilityQuoteEstimator(async input => {
        capturedOptions = input.options;
        return { currency: 'USD', estimatedCost: 0.04, source: 'test-default-options' };
      });
      await api.call('openmotion_capability_discover', { action: 'quote', capabilityId: 'upscale-4k' });
      assert.deepEqual(capturedOptions, { scale: '4x' });
      assert.equal(submitCalls, 0, 'dryRun and quote checks must never invoke gateway.submit');
    } finally {
      registerCapabilityQuoteEstimator(undefined);
      unregisterCapabilityScriptExecutor('test-concurrent-script');
      unregisterCapabilityScriptExecutor('test-retry-script');
      gateway.submit = origSubmit;
    }
  }, false));

test('static-policy quotes require explicit approval for all billed media capabilities (image, music, speech) and raw models', () =>
  fixture(async store => {
    const api = service(store);
    const musicQuote = await api.call('openmotion_capability_discover', { action: 'quote', capabilityId: 'music' });
    assert.equal(musicQuote.quote.requiresExplicitApproval, true);
    const imageQuote = await api.call('openmotion_capability_discover', { action: 'quote', capabilityId: 'text-to-image' });
    assert.equal(imageQuote.quote.requiresExplicitApproval, true);
    const speechQuote = await api.call('openmotion_capability_discover', { action: 'quote', capabilityId: 'speech' });
    assert.equal(speechQuote.quote.requiresExplicitApproval, true);
    const removeBgQuote = await api.call('openmotion_capability_discover', { action: 'quote', capabilityId: 'remove-background' });
    assert.equal(removeBgQuote.quote.requiresExplicitApproval, true);
    const asrQuote = await api.call('openmotion_capability_discover', { action: 'quote', capabilityId: 'asr-transcribe' });
    assert.equal(asrQuote.quote.requiresExplicitApproval, false);
  }, false));

test('capability_discover forwards modality to inspect so image-only providers do not hide missing audio sign-in or subscription handoffs', t =>
  fixture(async store => {
    const api = service(store);
    const gateway = gatewayFor(store);
    gateway.options.detect = async () => [
      { id: 'codex', label: 'Codex', installed: true, authenticated: true, imageGeneration: true, available: true, reason: 'fixture' },
    ];
    let accountState: { state: 'signed-out' | 'signed-in'; plan?: 'free' | 'go' | 'plus'; billingUnavailable: boolean } = {
      state: 'signed-out',
      billingUnavailable: false,
    };
    t.mock.method(gateway.account, 'summary', async () => accountState);
    t.mock.method(gateway.account, 'mediaModels', async () => []);
    t.mock.method(gateway.account, 'upgradeLink', async (entryId: string) => ({
      url: `https://open-design.ai/cloud/dashboard?billing=plan&od_entry_id=opengame-${entryId}`,
    }));

    // 1. Signed out + Codex image-only: audio discovery MUST still return agent_media_signed_out
    const listAudioSignedOut = await api.call('openmotion_capability_discover', { action: 'list', modality: 'audio' });
    assert.deepEqual(listAudioSignedOut.settingsHandoff, {
      tool: 'openmotion_open_preview',
      arguments: { target: 'providers', entry: 'agent_media_signed_out' },
    });
    const providersAudioSignedOut = await api.call('openmotion_capability_discover', { action: 'providers', modality: 'audio' });
    assert.deepEqual(providersAudioSignedOut.settingsHandoff, {
      tool: 'openmotion_open_preview',
      arguments: { target: 'providers', entry: 'agent_media_signed_out' },
    });

    // Image discovery sees Codex as usable, so no sign-in handoff entry is needed for image
    const providersImageSignedOut = await api.call('openmotion_capability_discover', { action: 'providers', modality: 'image' });
    assert.deepEqual(providersImageSignedOut.settingsHandoff, {
      tool: 'openmotion_open_preview',
      arguments: { target: 'providers' },
    });

    // 2. Signed in on Free / Go + Codex image-only: audio discovery MUST return subscription upgrade handoff + link
    for (const plan of ['free', 'go'] as const) {
      accountState = { state: 'signed-in', plan, billingUnavailable: false };
      const listAudioUpgrade = await api.call('openmotion_capability_discover', { action: 'list', modality: 'audio' });
      assert.deepEqual(listAudioUpgrade.settingsHandoff, {
        tool: 'openmotion_open_preview',
        arguments: { target: 'providers', entry: `agent_media_upgrade_${plan}` },
      });
      assert.match(listAudioUpgrade.upgrade?.url ?? '', /billing=plan/);

      const providersAudioUpgrade = await api.call('openmotion_capability_discover', { action: 'providers', modality: 'audio' });
      assert.deepEqual(providersAudioUpgrade.settingsHandoff, {
        tool: 'openmotion_open_preview',
        arguments: { target: 'providers', entry: `agent_media_upgrade_${plan}` },
      });
      assert.match(providersAudioUpgrade.upgrade?.url ?? '', /billing=plan/);
    }

    // 3. 3D placeholder stays safely discoverable without throwing
    const models3d = await api.call('openmotion_capability_discover', { action: 'models', modality: '3d' });
    assert.deepEqual(models3d, { providers: [], catalogs: [], setupRequired: true });
  }, false));

function makeTinyWav(): Buffer {
  const sampleRate = 8000;
  const numSamples = 800; // 0.1s silence
  const dataSize = numSamples * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataSize, 40);
  return buf;
}

function makeTinyGlb(): Buffer {
  const json = JSON.stringify({
    asset: { version: '2.0' },
    meshes: [{ name: 'HeroMesh', primitives: [{ attributes: { POSITION: 0 } }] }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }],
    buffers: [{ byteLength: 36 }],
    nodes: [{ name: 'mixamorigRightHand' }],
    skins: [{ joints: [0] }],
    animations: [{ name: 'Idle', channels: [], samplers: [] }],
  });
  let jsonBuf = Buffer.from(json, 'utf8');
  const jsonPad = (4 - (jsonBuf.length % 4)) % 4;
  if (jsonPad) jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc(jsonPad, 0x20)]);
  const binBuf = Buffer.alloc(36);
  const totalLen = 12 + 8 + jsonBuf.length + 8 + binBuf.length;
  const header = Buffer.alloc(12);
  header.write('glTF', 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(totalLen, 8);
  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(jsonBuf.length, 0);
  jsonHeader.write('JSON', 4);
  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(binBuf.length, 0);
  binHeader.write('BIN\0', 4);
  return Buffer.concat([header, jsonHeader, jsonBuf, binHeader, binBuf]);
}

test('sound-effects capability gates honestly on AMR audio_sound_effects and submits exact AMR #1161 contract', () =>
  fixture(async store => {
    const api = service(store);
    const gateway = gatewayFor(store);
    const wavBytes = makeTinyWav();
    let sfxEnabled = false;
    const submittedRequests: { url: string; body: any }[] = [];

    gateway.options.pollMs = 10;
    gateway.options.download = async () => wavBytes;
    gateway.options.fetcher = (async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/v1/media/models')) {
        assert.match(url, /include_audio=true/);
        const models: any[] = [
          { model: 'elevenlabs-music-v2', kind: 'audio_music' },
        ];
        if (sfxEnabled) {
          models.push({ model: 'elevenlabs-sound-v3', kind: 'audio_sound_effects' });
        }
        return new Response(JSON.stringify({ models }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.endsWith('/api/v1/media/audio/sound-effects') && init?.method === 'POST') {
        const body = JSON.parse(String(init.body ?? '{}'));
        submittedRequests.push({ url, body });
        return new Response(JSON.stringify({ task_id: 'sfx_task_01', status: 'queued' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.endsWith('/api/v1/media/audio/tasks/sfx_task_01')) {
        return new Response(JSON.stringify({
          task_id: 'sfx_task_01',
          status: 'succeeded',
          assets: [{ url: 'https://cdn.example.invalid/coin.wav' }],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({ error: `unexpected ${url}` }), { status: 404 });
    }) as typeof fetch;

    await gateway.configureProvider('opendesign', { apiKey: 'sk-test-opendesign', baseUrl: 'https://amr-mock.example.com', enabled: true });
    await gateway.listModels({ provider: 'opendesign', refresh: true });

    const listBefore = await api.call('openmotion_capability_discover', { action: 'list', modality: 'audio' });
    const sfxBefore = listBefore.capabilities.find((c: any) => c.id === 'sound-effects');
    const musicBefore = listBefore.capabilities.find((c: any) => c.id === 'music');
    assert.equal(sfxBefore?.available, false);
    assert.equal(sfxBefore?.compatibleModelCount, 0);
    assert.equal(musicBefore?.available, true);

    sfxEnabled = true;
    await gateway.listModels({ provider: 'opendesign', refresh: true });

    const listAfter = await api.call('openmotion_capability_discover', { action: 'list', modality: 'audio' });
    const sfxAfter = listAfter.capabilities.find((c: any) => c.id === 'sound-effects');
    assert.equal(sfxAfter?.available, true);
    assert.equal(sfxAfter?.recommendedModel, 'opendesign:elevenlabs-sound-v3');

    const musicDesc = await api.call('openmotion_capability_discover', { action: 'describe', capabilityId: 'music' });
    assert.ok(!musicDesc.capability.compatibleModels.some((m: any) => m.modelId === 'elevenlabs-sound-v3'));

    const submitted = await api.call('openmotion_capability_run', {
      action: 'run',
      requestId: 'sfx-amr-1',
      capabilityId: 'sound-effects',
      prompt: 'Crisp metallic coin chime',
      parameters: { duration_seconds: 1.5, loop: false, prompt_influence: 0.6 },
    });
    assert.equal(submitted.selectedModel, 'opendesign:elevenlabs-sound-v3');

    await gateway.tick();
    await Promise.all([...gateway.active.values()].map(task => task.done));

    assert.equal(submittedRequests.length, 1);
    assert.deepEqual(submittedRequests[0].body, {
      model: 'elevenlabs-sound-v3',
      parameters: {
        text: 'Crisp metallic coin chime',
        duration_seconds: 1.5,
        loop: false,
        prompt_influence: 0.6,
      },
    });
    assert.equal('voice' in submittedRequests[0].body, false);

    const jobState = await api.call('openmotion_job_manage', { action: 'status', jobId: submitted.job.id });
    assert.equal(jobState.job.state, 'completed');
    const ref = jobState.job.libraryAssets[0];
    const inspected = await api.call('openmotion_asset_manage', { action: 'get', assetId: ref.assetId, versionId: ref.versionId });
    assert.equal(inspected.asset.modality, 'audio');
    assert.equal(inspected.version.audioKind, 'sfx');
    assert.equal(inspected.version.capabilityId, 'sound-effects');
  }, false));

test('3d-asset capability gates honestly on AMR 3d_generations and executes Tripo 3D v3 image_to_model + rig + retarget + GLB asset inspection', () =>
  fixture(async store => {
    clearOpenDesign3dDiscoveryCache();
    const api = service(store);
    const gateway = gatewayFor(store);
    const glbBytes = makeTinyGlb();
    let threeDEnabled = false;
    let uploadPutCount = 0;
    const submitted3dTasks: any[] = [];

    gateway.options.pollMs = 10;
    gateway.options.fetcher = (async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/v1/media/models')) {
        assert.match(url, /include_audio=true/, 'spatial discovery must pass include_audio=true so AMR exposes 3d_generations');
        const models: any[] = [{ model: 'gpt-image-2.6-flare', kind: 'image' }];
        if (threeDEnabled) {
          models.push({ model: 'tripo-3.0', kind: '3d_generations', capabilities: { operations: ['text_to_model', 'image_to_model', 'rig', 'retarget'] } });
        }
        return new Response(JSON.stringify({ models }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.endsWith('/api/v1/media/uploads') && init?.method === 'POST') {
        return new Response(JSON.stringify({
          asset_id: 'upload_img_01',
          upload_url: 'https://storage.example.invalid/put-img-01',
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url === 'https://storage.example.invalid/put-img-01' && init?.method === 'PUT') {
        uploadPutCount += 1;
        return new Response('', { status: 200 });
      }
      if (url.endsWith('/api/v1/media/uploads/upload_img_01/commit') && init?.method === 'POST') {
        return new Response(JSON.stringify({ status: 'ready' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.endsWith('/api/v1/media/3d/tasks') && init?.method === 'POST') {
        const body = JSON.parse(String(init.body ?? '{}'));
        submitted3dTasks.push(body);
        const taskId = `tripo_${body.operation}_${submitted3dTasks.length}`;
        return new Response(JSON.stringify({ task_id: taskId, status: 'queued' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.endsWith('/artifacts/model.glb')) {
        return new Response(glbBytes, { status: 200, headers: { 'Content-Type': 'model/gltf-binary' } });
      }
      if (url.includes('/api/v1/media/3d/tasks/tripo_')) {
        const taskId = url.split('/').pop()!;
        return new Response(JSON.stringify({
          task_id: taskId,
          status: 'succeeded',
          artifacts: [{ name: 'model.glb', content_type: 'model/gltf-binary', content_path: `/api/v1/media/3d/tasks/${taskId}/artifacts/model.glb` }],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({ error: `unexpected ${url}` }), { status: 404 });
    }) as typeof fetch;

    await gateway.configureProvider('opendesign', { apiKey: 'sk-test-opendesign', baseUrl: 'https://amr-mock.example.com', enabled: true });

    try {
      const listBefore = await api.call('openmotion_capability_discover', { action: 'list', modality: '3d', refresh: true });
      const capBefore = listBefore.capabilities.find((c: any) => c.id === '3d-asset');
      assert.equal(capBefore?.available, false);
      assert.equal(capBefore?.compatibleModelCount, 0);
      const modelsBefore = await api.call('openmotion_capability_discover', { action: 'models', modality: '3d', refresh: true });
      assert.equal(modelsBefore.setupRequired, true);
      await assert.rejects(
        api.call('openmotion_capability_run', { action: 'run', capabilityId: '3d-asset', dryRun: true, prompt: 'Low-poly mecha knight' }),
        /CAPABILITY_UNAVAILABLE/,
      );

      threeDEnabled = true;
      const listAfter = await api.call('openmotion_capability_discover', { action: 'list', modality: '3d', refresh: true });
      const capAfter = listAfter.capabilities.find((c: any) => c.id === '3d-asset');
      assert.equal(capAfter?.available, true);
      assert.equal(capAfter?.compatibleModelCount, 1);
      assert.equal(capAfter?.recommendedModel, 'opendesign:tripo-3.0');

      const modelsAfter = await api.call('openmotion_capability_discover', { action: 'models', modality: '3d', refresh: true });
      assert.equal(modelsAfter.setupRequired, false);
      assert.equal(modelsAfter.catalogs[0].models[0].modelId, 'tripo-3.0');
      assert.equal(modelsAfter.catalogs[0].models[0].capabilityId, '3d-asset');

      const refPng = await makePng(store.directory, 'hero-ref.png', 'navy');
      const importedRef = await api.call('openmotion_asset_manage', {
        action: 'import',
        requestId: 'import-3d-ref-1',
        sourcePath: refPng,
        name: 'Hero Concept',
      });

      // Explicit provider selection must be respected (account is not configured -> rejects cleanly)
      await assert.rejects(
        api.call('openmotion_capability_run', {
          action: 'run',
          capabilityId: '3d-asset',
          model: 'account:tripo-3.0',
          dryRun: true,
          prompt: 'Stylized knight hero',
        }),
        /CAPABILITY_UNAVAILABLE/,
      );

      const runResult = await api.call('openmotion_capability_run', {
        action: 'run',
        requestId: 'tripo-hero-1',
        capabilityId: '3d-asset',
        model: 'opendesign:tripo-3.0',
        prompt: 'Stylized knight hero',
        options: { operation: 'image_to_model', quality: 'prop-low', rigPreset: 'mixamo-idle' },
        references: [{ assetId: importedRef.asset.id, versionId: importedRef.asset.currentVersionId }],
        parameters: { slim: false, quad: true },
        name: 'Knight Hero GLB',
      });

      assert.equal(uploadPutCount, 1);
      assert.equal(submitted3dTasks.length, 3);
      assert.equal(submitted3dTasks[0].model, 'tripo-3.0');
      assert.equal(submitted3dTasks[0].operation, 'image_to_model');
      assert.deepEqual(submitted3dTasks[0].image_asset_ids, ['upload_img_01']);
      assert.equal(submitted3dTasks[0].parameters.face_limit, 5000);
      assert.equal('quad' in submitted3dTasks[0].parameters, false);
      assert.equal(submitted3dTasks[1].operation, 'rig');
      assert.equal(submitted3dTasks[1].parameters.model_version, 'v1.0-20240301');
      assert.equal(submitted3dTasks[1].parameters.original_model_task_id, 'tripo_image_to_model_1');
      assert.equal(submitted3dTasks[2].operation, 'retarget');
      assert.equal(submitted3dTasks[2].parameters.animation, 'preset:idle');
      assert.equal(submitted3dTasks[2].parameters.animate_in_place, true);
      assert.equal(submitted3dTasks[2].parameters.original_model_task_id, 'tripo_rig_2');

      assert.equal(runResult.asset.modality, '3d');
      assert.equal(runResult.version.mimeType, 'model/gltf-binary');
      assert.match(runResult.mediaUrl, /^\/motion-api\/assets\/[^/]+\/versions\/[^/]+\/file$/);
      assert.equal(runResult.result.triangles, 1);
      assert.equal(runResult.result.skins, 1);
      assert.deepEqual(runResult.result.animationNames, ['Idle']);

      const replayed = await api.call('openmotion_capability_run', {
        action: 'run',
        requestId: 'tripo-hero-1',
        capabilityId: '3d-asset',
        model: 'opendesign:tripo-3.0',
        prompt: 'Stylized knight hero',
        options: { operation: 'image_to_model', quality: 'prop-low', rigPreset: 'mixamo-idle' },
        references: [{ assetId: importedRef.asset.id, versionId: importedRef.asset.currentVersionId }],
        parameters: { slim: false, quad: true },
        name: 'Knight Hero GLB',
      });
      assert.equal(replayed.replayed, true);
      assert.equal(replayed.mediaUrl, runResult.mediaUrl);
      assert.equal(submitted3dTasks.length, 3);

      const listed3d = await api.call('openmotion_asset_manage', { action: 'list', modality: '3d' });
      assert.equal(listed3d.assets.length, 1);
      assert.equal(listed3d.assets[0].id, runResult.asset.id);

      const read3d = await api.call('openmotion_asset_manage', {
        action: 'read',
        assetId: runResult.asset.id,
        versionId: runResult.version.id,
      });
      assert.equal(read3d.modality, '3d');
      assert.ok(read3d.content.some((block: any) => block.type === 'text' && /"triangleCount":\s*1\b/.test(block.text)));
      assert.equal(runResult.result.rigTaskId, 'tripo_rig_2');
      assert.ok(Array.isArray(runResult.result.boneNames) && runResult.result.boneNames.length >= 1);

      // 2-step mixamo-only rig submits image_to_model -> rig without an extra retarget task, and returns rigTaskId for reuse.
      const beforeRigOnly = submitted3dTasks.length;
      const rigOnly = await api.call('openmotion_capability_run', {
        action: 'run',
        requestId: 'tripo-hero-rig-only',
        capabilityId: '3d-asset',
        model: 'opendesign:tripo-3.0',
        options: { operation: 'image_to_model', quality: 'hero-balanced', rigPreset: 'mixamo-only' },
        references: [{ assetId: importedRef.asset.id, versionId: importedRef.asset.currentVersionId }],
        parameters: { slim: false },
        name: 'Knight Rigged Skeleton',
      });
      assert.equal(submitted3dTasks.length - beforeRigOnly, 2);
      assert.equal(submitted3dTasks[beforeRigOnly].operation, 'image_to_model');
      assert.equal(submitted3dTasks[beforeRigOnly + 1].operation, 'rig');
      assert.equal(rigOnly.result.operation, 'rig');
      assert.ok(rigOnly.result.rigTaskId);

      // Reusing rigTaskId via operation="retarget" with multi-clip parameters.animations skips mesh & rig tasks.
      const beforeRetarget = submitted3dTasks.length;
      const retargeted = await api.call('openmotion_capability_run', {
        action: 'run',
        requestId: 'tripo-hero-retarget-multi',
        capabilityId: '3d-asset',
        model: 'opendesign:tripo-3.0',
        options: { operation: 'retarget' },
        parameters: {
          slim: false,
          original_model_task_id: rigOnly.result.rigTaskId,
          animations: ['preset:idle', 'preset:walk', 'preset:slash'],
        },
        name: 'Knight Retargeted Clips',
      });
      assert.equal(submitted3dTasks.length - beforeRetarget, 1);
      assert.equal(submitted3dTasks[beforeRetarget].operation, 'retarget');
      assert.equal(submitted3dTasks[beforeRetarget].parameters.original_model_task_id, rigOnly.result.rigTaskId);
      assert.deepEqual(submitted3dTasks[beforeRetarget].parameters.animations, ['preset:idle', 'preset:walk', 'preset:slash']);
      assert.deepEqual(retargeted.result.requestedAnimations, ['preset:idle', 'preset:walk', 'preset:slash']);
      assert.equal(retargeted.result.animations, 1);

      // Default operation="auto" with only parameters.original_model_task_id infers "rig" instead of paying for a fresh text_to_model mesh.
      const described3d = await api.call('openmotion_capability_discover', { action: 'describe', capabilityId: '3d-asset' });
      assert.equal(described3d.capability.input.controls[0]?.defaultValue, 'auto');
      const beforeAutoOriginal = submitted3dTasks.length;
      const autoRig = await api.call('openmotion_capability_run', {
        action: 'run',
        requestId: 'tripo-auto-reuse-task',
        capabilityId: '3d-asset',
        model: 'opendesign:tripo-3.0',
        parameters: {
          slim: false,
          original_model_task_id: rigOnly.result.baseTaskId,
        },
        name: 'Knight Auto Reused Rig',
      });
      assert.equal(submitted3dTasks.length - beforeAutoOriginal, 1);
      assert.equal(submitted3dTasks[beforeAutoOriginal].operation, 'rig');
      assert.equal(submitted3dTasks[beforeAutoOriginal].parameters.original_model_task_id, rigOnly.result.baseTaskId);
      assert.equal(autoRig.result.operation, 'rig');
      assert.equal(autoRig.result.animation, undefined);
      assert.equal(autoRig.result.requestedAnimations, undefined);

      // Combining operation="rig" with an animation rigPreset promotes to rig_retarget so provenance matches actual retarget execution.
      const beforeRigWithPreset = submitted3dTasks.length;
      const rigPromoted = await api.call('openmotion_capability_run', {
        action: 'run',
        requestId: 'tripo-rig-with-walk-preset',
        capabilityId: '3d-asset',
        model: 'opendesign:tripo-3.0',
        options: { operation: 'rig', rigPreset: 'mixamo-walk' },
        parameters: {
          slim: false,
          original_model_task_id: rigOnly.result.baseTaskId,
        },
        name: 'Knight Rig Walk Promoted',
      });
      assert.equal(submitted3dTasks.length - beforeRigWithPreset, 2);
      assert.equal(submitted3dTasks[beforeRigWithPreset].operation, 'rig');
      assert.equal(submitted3dTasks[beforeRigWithPreset + 1].operation, 'retarget');
      assert.equal(rigPromoted.result.operation, 'rig_retarget');
      assert.equal(rigPromoted.result.animation, 'preset:walk');

      // Explicit operation="rig_retarget" with default rigPreset="none" and no animation fails fast with 0 paid submissions.
      const beforeInvalidRigRetarget = submitted3dTasks.length;
      await assert.rejects(
        api.call('openmotion_capability_run', {
          action: 'run',
          requestId: 'tripo-rig-retarget-missing-anim',
          capabilityId: '3d-asset',
          model: 'opendesign:tripo-3.0',
          options: { operation: 'rig_retarget' },
          prompt: 'Knight without animation',
        }),
        /rig_retarget requires an animation/,
      );
      assert.equal(submitted3dTasks.length, beforeInvalidRigRetarget);

      // Corrupt checkpoint JSON must surface an error instead of silently restarting a paid 3D task.
      const corruptReqId = 'tripo-corrupt-checkpoint-1';
      const requestsDir = path.join(store.directory, 'assets', 'requests');
      await mkdir(requestsDir, { recursive: true });
      await writeFile(path.join(requestsDir, `spatial-3d-${assetHash(corruptReqId)}.json`), '{corrupt-json', 'utf8');
      const beforeCorrupt = submitted3dTasks.length;
      await assert.rejects(
        api.call('openmotion_capability_run', {
          action: 'run',
          requestId: corruptReqId,
          capabilityId: '3d-asset',
          model: 'opendesign:tripo-3.0',
          prompt: 'Should refuse to re-bill on corrupt checkpoint',
        }),
        /checkpoint is unreadable/i,
      );
      assert.equal(submitted3dTasks.length, beforeCorrupt);

      // Reusing a failed requestId's checkpoint with different inputs must fail with REQUEST_ID_CONFLICT and 0 paid submissions.
      const mismatchReqId = 'tripo-checkpoint-input-mismatch-1';
      await writeFile(
        path.join(requestsDir, `spatial-3d-${assetHash(mismatchReqId)}.json`),
        JSON.stringify({ inputFingerprint: 'different-input-fingerprint', baseTaskId: 'tripo_prior_paid_task' }),
        'utf8',
      );
      const beforeMismatch = submitted3dTasks.length;
      await assert.rejects(
        api.call('openmotion_capability_run', {
          action: 'run',
          requestId: mismatchReqId,
          capabilityId: '3d-asset',
          model: 'opendesign:tripo-3.0',
          prompt: 'Changed prompt reusing prior requestId',
        }),
        /REQUEST_ID_CONFLICT/,
      );
      assert.equal(submitted3dTasks.length, beforeMismatch);

      // Any OpenDesign audio model matching isSfxModel (by modelId or label) exposes duration_seconds, loop, and prompt_influence.
      const customSfxOpts = generationOptions({
        id: 'opendesign:custom-audio-v2',
        provider: 'opendesign',
        modelId: 'custom-audio-v2',
        label: 'Custom Foley SFX v2',
        modality: 'audio',
        mode: 'text-to-audio',
        source: 'discovered',
        enabled: true,
      });
      assert.deepEqual(
        customSfxOpts?.fields.map(field => field.key),
        ['duration_seconds', 'loop', 'prompt_influence'],
      );
    } finally {
      clearOpenDesign3dDiscoveryCache();
    }
  }, false));

test('3d-world capability gates honestly on AMR world_generations and follows World Labs Atlas v2 contract (atlasTextToImage PNG, validation guardrails, and GLB mesh selection)', () =>
  fixture(async store => {
    clearOpenDesign3dDiscoveryCache();
    const api = service(store);
    const gateway = gatewayFor(store);
    const glbBytes = makeTinyGlb();
    const pngBytes = await readFile(await makePng(store.directory, 'atlas-frame.png', '0x3b82f6'));
    let worldEnabled = false;
    const worldPosts: any[] = [];

    gateway.options.pollMs = 10;
    gateway.options.fetcher = (async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/v1/media/models')) {
        assert.match(url, /include_audio=true/, 'world discovery must pass include_audio=true so AMR exposes world_generations');
        const models: any[] = [{ model: 'gpt-image-2.6-flare', kind: 'image' }];
        if (worldEnabled) {
          models.push({ model: 'worldlabs-atlas', kind: 'world_generations' });
        }
        return new Response(JSON.stringify({ models }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.endsWith('/api/v1/media/uploads') && init?.method === 'POST') {
        return new Response(JSON.stringify({
          asset_id: 'world_upload_ref_1',
          upload_url: 'https://amr-mock.example.com/upload/world-ref-1',
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url === 'https://amr-mock.example.com/upload/world-ref-1' && init?.method === 'PUT') {
        return new Response(null, { status: 200 });
      }
      if (url.endsWith('/api/v1/media/uploads/world_upload_ref_1/commit') && init?.method === 'POST') {
        return new Response(JSON.stringify({ asset_id: 'world_upload_ref_1', status: 'ready' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.endsWith('/api/v1/media/worlds/tasks') && init?.method === 'POST') {
        const body = JSON.parse(String(init.body ?? '{}'));
        worldPosts.push(body);
        const taskId = body.operation === 'atlasTextToImage' || body.operation === 'images2PosedRGBD' || body.operation === 'atlasGenerate'
          ? 'world_task_t2i'
          : body.operation === 'posedImages2Splats'
            ? 'world_task_splats'
            : 'world_task_mesh';
        return new Response(JSON.stringify({ task_id: taskId, status: 'queued' }), { status: 202, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.includes('/api/v1/media/worlds/tasks/world_task_t2i/content')) {
        assert.match(url, /artifact=frames_0_image/);
        return new Response(pngBytes, { status: 200, headers: { 'Content-Type': 'image/png' } });
      }
      if (url.endsWith('/api/v1/media/worlds/tasks/world_task_t2i')) {
        return new Response(JSON.stringify({
          task_id: 'world_task_t2i',
          status: 'succeeded',
          model: 'atlas-v2',
          artifacts: [
            { name: 'frames_0_image', asset_id: 'asset_frame_0', content_path: '/api/v1/media/worlds/tasks/world_task_t2i/content?artifact=frames_0_image' },
          ],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.includes('/api/v1/media/worlds/tasks/world_task_mesh/content')) {
        assert.match(url, /artifact=colliderMesh/);
        return new Response(glbBytes, { status: 200, headers: { 'Content-Type': 'application/octet-stream' } });
      }
      if (url.endsWith('/api/v1/media/worlds/tasks/world_task_mesh')) {
        return new Response(JSON.stringify({
          task_id: 'world_task_mesh',
          status: 'succeeded',
          artifacts: [
            { name: 'splats', format: 'spz', asset_id: 'a1', content_path: '/api/v1/media/worlds/tasks/world_task_mesh/content?artifact=splats' },
            { name: 'colliderMesh', format: 'glb', asset_id: 'a2', content_path: '/api/v1/media/worlds/tasks/world_task_mesh/content?artifact=colliderMesh' },
          ],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.includes('/api/v1/media/worlds/tasks/world_task_splats/content')) {
        return new Response(Buffer.from('SPZ_RAW_DATA'), { status: 200, headers: { 'Content-Type': 'application/octet-stream' } });
      }
      if (url.endsWith('/api/v1/media/worlds/tasks/world_task_splats')) {
        return new Response(JSON.stringify({
          task_id: 'world_task_splats',
          status: 'succeeded',
          artifacts: [
            { name: 'splats', format: 'spz', asset_id: 'a3', content_path: '/api/v1/media/worlds/tasks/world_task_splats/content?artifact=splats' },
          ],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({ error: `unexpected ${url}` }), { status: 404 });
    }) as typeof fetch;

    await gateway.configureProvider('opendesign', { apiKey: 'sk-test-opendesign', baseUrl: 'https://amr-mock.example.com', enabled: true });

    try {
      const before = await api.call('openmotion_capability_discover', { action: 'list', modality: '3d', refresh: true });
      const capBefore = before.capabilities.find((c: any) => c.id === '3d-world');
      assert.equal(capBefore?.available, false);
      await assert.rejects(
        api.call('openmotion_capability_run', { action: 'run', capabilityId: '3d-world', dryRun: true, prompt: 'Floating sky temple courtyard' }),
        /CAPABILITY_UNAVAILABLE/,
      );

      worldEnabled = true;
      const after = await api.call('openmotion_capability_discover', { action: 'list', modality: '3d', refresh: true });
      const capAfter = after.capabilities.find((c: any) => c.id === '3d-world');
      assert.equal(capAfter?.available, true);
      assert.equal(capAfter?.recommendedModel, 'opendesign:worldlabs-atlas');

      const described = await api.call('openmotion_capability_discover', { action: 'describe', capabilityId: '3d-world' });
      assert.equal(described.capability.input.controls[0]?.key, 'operation');
      assert.equal(described.capability.input.controls[0]?.defaultValue, 'auto');

      const models3d = await api.call('openmotion_capability_discover', { action: 'models', modality: '3d', refresh: true });
      assert.equal(models3d.setupRequired, false);
      assert.equal(models3d.catalogs[0].models[0].modelId, 'worldlabs-atlas');
      assert.equal(models3d.catalogs[0].models[0].capabilityId, '3d-world');

      // 1) Guardrail: atlasGenerate without contextFrames/targetCameras fails fast locally with 0 submissions
      await assert.rejects(
        api.call('openmotion_capability_run', {
          action: 'run',
          requestId: 'world-atlas-invalid-gen',
          capabilityId: '3d-world',
          options: { operation: 'atlasGenerate' },
          prompt: 'Floating sky temple courtyard',
        }),
        /contextFrames.*targetCameras/,
      );
      await assert.rejects(
        api.call('openmotion_capability_run', {
          action: 'run',
          requestId: 'world-atlas-invalid-rgbd',
          capabilityId: '3d-world',
          options: { operation: 'images2PosedRGBD' },
          prompt: 'Missing reference image',
        }),
        /requires at least 1 reference image/,
      );
      assert.equal(worldPosts.length, 0);

      // 2) Pure text default submits atlasTextToImage and imports the returned PNG frame cleanly
      const t2i = await api.call('openmotion_capability_run', {
        action: 'run',
        requestId: 'world-atlas-t2i-1',
        capabilityId: '3d-world',
        prompt: 'Floating sky temple courtyard',
        name: 'Sky Temple Concept Frame',
      });
      assert.equal(worldPosts.length, 1);
      assert.deepEqual(worldPosts[0], {
        model: 'worldlabs-atlas',
        operation: 'atlasTextToImage',
        prompt: 'Floating sky temple courtyard',
      });
      assert.equal(t2i.asset.modality, 'image');
      assert.equal(t2i.version.width, 32);
      assert.equal(t2i.version.height, 24);
      assert.equal(t2i.result.operation, 'atlasTextToImage');
      assert.equal(t2i.result.selectedArtifact, 'frames_0_image');
      assert.equal(t2i.result.artifactFormat, 'png');
      assert.equal(t2i.result.mimeType, 'image/png');
      assert.equal(t2i.result.artifacts.length, 1);
      assert.match(t2i.mediaUrl, /^\/motion-api\/assets\/[^/]+\/versions\/[^/]+\/file$/);

      // 3) Multi-artifact mesh operation (splats2Mesh) selects colliderMesh GLB and preserves splats descriptor
      const meshRes = await api.call('openmotion_capability_run', {
        action: 'run',
        requestId: 'world-atlas-mesh-1',
        capabilityId: '3d-world',
        options: { operation: 'splats2Mesh' },
        parameters: { splatAssetId: 'a1', slim: false },
        name: 'Sky Temple Mesh',
      });
      assert.equal(worldPosts.length, 2);
      assert.deepEqual(worldPosts[1], {
        model: 'worldlabs-atlas',
        operation: 'splats2Mesh',
        parameters: { splatAssetId: 'a1' },
      });
      assert.equal(meshRes.asset.modality, '3d');
      assert.equal(meshRes.result.selectedArtifact, 'colliderMesh');
      assert.equal(meshRes.result.artifactFormat, 'glb');
      assert.equal(meshRes.result.artifacts.length, 2);
      assert.equal(meshRes.result.artifacts[0].name, 'splats');
      assert.equal(meshRes.result.triangles, 1);

      // 4) Non-library .spz-only output surfaces clear guidance instead of raw binary GLB parse failure
      await assert.rejects(
        api.call('openmotion_capability_run', {
          action: 'run',
          requestId: 'world-atlas-splats-only',
          capabilityId: '3d-world',
          options: { operation: 'posedImages2Splats' },
          parameters: { posedFrames: [{ id: 'f0' }] },
        }),
        /splats2Mesh/,
      );

      // 5) Default operation="auto" stays reachable through openmotion_capability_run:
      //    (a) pinned reference image + empty prompt auto-infers images2PosedRGBD
      const refPngPath = await makePng(store.directory, 'world-ref-input.png', '0x10b981');
      const refAsset = await api.call('openmotion_asset_manage', {
        action: 'import',
        requestId: 'import-world-ref-1',
        sourcePath: refPngPath,
        name: 'World Input Ref',
      });
      const beforeAutoRgbd = worldPosts.length;
      const autoRgbd = await api.call('openmotion_capability_run', {
        action: 'run',
        requestId: 'world-atlas-auto-rgbd',
        capabilityId: '3d-world',
        references: [{ assetId: refAsset.asset.id, versionId: refAsset.asset.currentVersionId }],
        name: 'Auto Posed RGBD',
      });
      assert.equal(worldPosts.length - beforeAutoRgbd, 1);
      assert.equal(worldPosts[beforeAutoRgbd].operation, 'images2PosedRGBD');
      assert.deepEqual(worldPosts[beforeAutoRgbd].image_asset_ids, ['world_upload_ref_1']);
      assert.equal(autoRgbd.result.operation, 'images2PosedRGBD');

      //    (b) contextFrames + targetCameras alone auto-infers atlasGenerate (following OD Cloud API schema)
      await assert.rejects(
        api.call('openmotion_capability_run', {
          action: 'run',
          requestId: 'world-atlas-malformed-frames',
          capabilityId: '3d-world',
          parameters: {
            contextFrames: [{ frameId: 'f0' }],
            targetCameras: [{ pose: [0, 0, 1] }],
          },
        }),
        /imageAsset.*camera.*extrinsics.*intrinsics/i,
      );
      const beforeAutoGen = worldPosts.length;
      const autoGen = await api.call('openmotion_capability_run', {
        action: 'run',
        requestId: 'world-atlas-auto-gen',
        capabilityId: '3d-world',
        parameters: {
          contextFrames: [{
            imageAsset: { assetId: 'asset_frame_0' },
            depth: { depthAsset: { assetId: 'asset_depth_0' } },
            camera: {
              extrinsics: { position: [0, 0, 0], quaternion: [0, 0, 0, 1] },
              intrinsics: { fx: 900, fy: 900, cx: 640, cy: 360, width: 1280, height: 720 },
            },
          }],
          targetCameras: [{
            extrinsics: { position: [0.5, 0, 0], quaternion: [0, 0, 0, 1] },
            intrinsics: { fx: 900, fy: 900, cx: 640, cy: 360, width: 1280, height: 720 },
          }],
          returnDepth: false,
        },
        name: 'Auto Atlas Generate',
      });
      assert.equal(worldPosts.length - beforeAutoGen, 1);
      assert.equal(worldPosts[beforeAutoGen].operation, 'atlasGenerate');
      assert.equal(autoGen.result.operation, 'atlasGenerate');
    } finally {
      clearOpenDesign3dDiscoveryCache();
    }
  }, false));

test('3d-asset production AMR submissions send canonical UUID X-OpenMotion-Job-Id and matching Idempotency-Key', () =>
  fixture(async store => {
    clearOpenDesign3dDiscoveryCache();
    const api = service(store);
    const gateway = gatewayFor(store);
    const glbBytes = makeTinyGlb();
    const seenHeaders: Array<{ sourceProduct: string | null; jobId: string | null; idempotencyKey: string | null }> = [];
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

    gateway.options.pollMs = 10;
    gateway.options.fetcher = (async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/v1/media/models')) {
        return new Response(JSON.stringify({
          models: [{ model: 'tripo-3.0', kind: '3d_generations' }],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.endsWith('/api/v1/media/3d/tasks') && init?.method === 'POST') {
        const headers = new Headers(init.headers);
        seenHeaders.push({
          sourceProduct: headers.get('X-Source-Product'),
          jobId: headers.get('X-OpenMotion-Job-Id'),
          idempotencyKey: headers.get('Idempotency-Key'),
        });
        return new Response(JSON.stringify({ task_id: 'tripo_prod_01', status: 'queued' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.endsWith('/artifacts/model.glb')) {
        return new Response(glbBytes, { status: 200, headers: { 'Content-Type': 'model/gltf-binary' } });
      }
      if (url.endsWith('/api/v1/media/3d/tasks/tripo_prod_01')) {
        return new Response(JSON.stringify({
          task_id: 'tripo_prod_01',
          status: 'succeeded',
          artifacts: [{ name: 'model.glb', content_type: 'model/gltf-binary', content_path: '/api/v1/media/3d/tasks/tripo_prod_01/artifacts/model.glb' }],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({ error: `unexpected ${url}` }), { status: 404 });
    }) as typeof fetch;

    await gateway.configureProvider('opendesign', {
      apiKey: 'sk-test-opendesign',
      baseUrl: 'https://amr-api.open-design.ai',
      enabled: true,
    });

    try {
      const res = await api.call('openmotion_capability_run', {
        action: 'run',
        requestId: 'courtyard_hero_3d_req_1',
        capabilityId: '3d-asset',
        prompt: 'Wuxia swordsman in dark indigo robes',
        parameters: { slim: false },
        name: 'Wuxia Swordsman',
      });
      assert.equal(res.asset.modality, '3d');
      assert.equal(seenHeaders.length, 1);
      assert.equal(seenHeaders[0].sourceProduct, 'openmotion');
      assert.ok(seenHeaders[0].jobId && uuidPattern.test(seenHeaders[0].jobId), `expected UUID X-OpenMotion-Job-Id, got ${seenHeaders[0].jobId}`);
      assert.equal(seenHeaders[0].idempotencyKey, seenHeaders[0].jobId);
    } finally {
      clearOpenDesign3dDiscoveryCache();
    }
  }, false));

test('capabilityRun resolves bare modelId without provider prefix against compatible models', () =>
  fixture(async store => {
    const api = service(store);
    const gateway = gatewayFor(store);
    const wavBytes = makeTinyWav();
    gateway.options.pollMs = 10;
    gateway.options.download = async () => wavBytes;
    gateway.options.fetcher = (async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/v1/media/models')) {
        return new Response(JSON.stringify({
          models: [{ model: 'elevenlabs-sound-v3', kind: 'audio_sound_effects' }],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.endsWith('/api/v1/media/audio/sound-effects') && init?.method === 'POST') {
        return new Response(JSON.stringify({ task_id: 'sfx_bare_01', status: 'queued' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.endsWith('/api/v1/media/audio/tasks/sfx_bare_01')) {
        return new Response(JSON.stringify({
          task_id: 'sfx_bare_01',
          status: 'succeeded',
          assets: [{ url: 'https://cdn.example.invalid/whoosh.wav' }],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({ error: `unexpected ${url}` }), { status: 404 });
    }) as typeof fetch;

    await gateway.configureProvider('opendesign', { apiKey: 'sk-test-opendesign', baseUrl: 'https://amr-mock.example.com', enabled: true });
    await gateway.listModels({ provider: 'opendesign', refresh: true });

    const submitted = await api.call('openmotion_capability_run', {
      action: 'run',
      requestId: 'sfx-bare-model-1',
      capabilityId: 'sound-effects',
      model: 'elevenlabs-sound-v3',
      prompt: 'Heavy bronze gong impact',
      parameters: { duration_seconds: 2 },
    });
    assert.equal(submitted.selectedModel, 'opendesign:elevenlabs-sound-v3');
    await gateway.tick();
    await Promise.all([...gateway.active.values()].map(task => task.done));
    const jobState = await api.call('openmotion_job_manage', { action: 'status', jobId: submitted.job.id });
    assert.equal(jobState.job.state, 'completed');
  }, false));

test('capabilityDiscover skips spatial probes for non-3D modalities and shares one catalogue fetch for unfiltered discovery', () =>
  fixture(async store => {
    clearOpenDesign3dDiscoveryCache();
    const api = service(store);
    const gateway = gatewayFor(store);
    let modelListRequests = 0;

    gateway.options.fetcher = (async (input: string | URL) => {
      const url = String(input);
      if (url.includes('/api/v1/media/models')) {
        modelListRequests += 1;
        return new Response(JSON.stringify({
          models: [
            { model: 'tripo-3.0', kind: '3d_generations' },
            { model: 'worldlabs-atlas', kind: 'world_generations' },
          ],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({ error: `unexpected ${url}` }), { status: 404 });
    }) as typeof fetch;

    await gateway.configureProvider('opendesign', { apiKey: 'sk-test-opendesign', baseUrl: 'https://amr-mock.example.com', enabled: true });

    try {
      modelListRequests = 0;
      await api.call('openmotion_capability_discover', { action: 'list', modality: 'image' });
      await api.call('openmotion_capability_discover', { action: 'list', modality: 'audio' });
      await api.call('openmotion_capability_discover', { action: 'describe', capabilityId: 'sound-effects' });
      assert.equal(modelListRequests, 0, 'non-3D capability discovery must not probe 3D/world catalogues');

      // Unfiltered list shares one spatial catalogue fetch across 3d-asset and 3d-world.
      const unfiltered = await api.call('openmotion_capability_discover', { action: 'list', refresh: true });
      assert.equal(modelListRequests, 1);
      assert.equal(unfiltered.capabilities.find((c: any) => c.id === '3d-asset')?.available, true);
      assert.equal(unfiltered.capabilities.find((c: any) => c.id === '3d-world')?.available, true);
    } finally {
      clearOpenDesign3dDiscoveryCache();
    }
  }, false));

test('3d-asset rejects non-image references locally before calling AMR upload endpoints', () =>
  fixture(async store => {
    clearOpenDesign3dDiscoveryCache();
    const api = service(store);
    const gateway = gatewayFor(store);
    let uploadRequests = 0;

    gateway.options.fetcher = (async (input: string | URL) => {
      const url = String(input);
      if (url.includes('/api/v1/media/models')) {
        return new Response(JSON.stringify({
          models: [{ model: 'tripo-3.0', kind: '3d_generations' }],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.includes('/api/v1/media/uploads') || url.includes('/api/v1/media/3d/tasks')) {
        uploadRequests += 1;
      }
      return new Response(JSON.stringify({ error: `unexpected ${url}` }), { status: 404 });
    }) as typeof fetch;

    await gateway.configureProvider('opendesign', { apiKey: 'sk-test-opendesign', baseUrl: 'https://amr-mock.example.com', enabled: true });

    const wavFile = path.join(store.directory, 'not-an-image.wav');
    await writeFile(wavFile, makeTinyWav());
    const wavAsset = await api.call('openmotion_asset_manage', {
      action: 'import',
      requestId: 'import-wav-for-3d-guard',
      sourcePath: wavFile,
      name: 'Not An Image',
    });

    try {
      await assert.rejects(
        api.call('openmotion_capability_run', {
          action: 'run',
          requestId: 'tripo-reject-non-image-ref',
          capabilityId: '3d-asset',
          references: [{ assetId: wavAsset.asset.id, versionId: wavAsset.asset.currentVersionId }],
        }),
        /PNG, JPEG, or WebP image/,
      );
      assert.equal(uploadRequests, 0, 'non-image 3D reference must fail before calling /uploads or /3d/tasks');
    } finally {
      clearOpenDesign3dDiscoveryCache();
    }
  }, false));

test('direct account sound-effects discovers via control-key probe, enforces 450-char cap, and completes /audio/sound-effects jobs', () =>
  fixture(async store => {
    const api = service(store);
    const gateway = gatewayFor(store);
    const wavBytes = makeTinyWav();
    const sfxPosts: any[] = [];
    const accountFetch = (async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === `${productionApi}/api/v1/billing/summary`) {
        return Response.json({ membershipTier: 'plus', balanceUsd: '10.00', totalAvailableCreditsUsd: '10.00' });
      }
      if (url === `${productionApi}/api/v1/media/models?include_audio=true`) {
        assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer acct-sfx-control');
        return Response.json({
          models: [{ model: 'elevenlabs-sound-v3', kind: 'audio_sound_effects' }],
        });
      }
      if (url === `${productionApi}/api/v1/media/audio/sound-effects` && init?.method === 'POST') {
        const body = JSON.parse(String(init.body ?? '{}'));
        sfxPosts.push(body);
        const taskId = sfxPosts.length === 1 ? 'acct_sfx_task_1' : 'acct_sfx_task_nosize';
        return Response.json({ task_id: taskId, status: 'queued' });
      }
      if (url === `${productionApi}/api/v1/media/audio/tasks/acct_sfx_task_1`) {
        return Response.json({
          task_id: 'acct_sfx_task_1',
          model: 'elevenlabs-sound-v3',
          status: 'succeeded',
          assets: [{ asset_id: 'acct_sfx_asset_1', size_bytes: wavBytes.length, mime_type: 'audio/wav', url: 'https://cdn.example.invalid/acct-gong.wav' }],
        });
      }
      if (url === `${productionApi}/api/v1/media/audio/tasks/acct_sfx_task_nosize`) {
        return Response.json({
          task_id: 'acct_sfx_task_nosize',
          model: 'elevenlabs-sound-v3',
          status: 'succeeded',
          assets: [{ asset_id: 'acct_sfx_asset_nosize', mime_type: 'audio/wav', url: 'https://cdn.example.invalid/acct-rain.wav' }],
        });
      }
      return new Response(JSON.stringify({ error: `unexpected ${url}` }), { status: 404 });
    }) as typeof fetch;

    const account = gateway.account = new OpenDesignAccount(store.directory, {
      pollMs: 10,
      fetcher: accountFetch,
      download: async () => new Response(wavBytes, {
        status: 200,
        headers: { etag: '"acct-sfx-1"', 'content-type': 'audio/wav', 'content-length': String(wavBytes.length) },
      }),
      run: async args => {
        if (args[0] === 'model') return JSON.stringify({ source: 'remote', data: [] });
        // Simulate an older CLI release that omits audio_sound_effects from `media models --json`.
        if (args[0] === 'media') return JSON.stringify({ models: [{ model: 'gpt-image-2.6-flare', kind: 'image' }] });
        return '{}';
      },
    });
    gateway.options.pollMs = 10;

    await mkdir(account.home, { recursive: true });
    await writeFile(path.join(account.root, 'session.json'), JSON.stringify({ id: 'acct-sfx-session' }));
    await writeFile(path.join(account.home, 'config.json'), JSON.stringify({
      profiles: {
        prod: {
          apiUrl: productionApi,
          user: { id: 'acct-sfx-user' },
          controlKey: 'acct-sfx-control',
          controlKeyId: 'acct-sfx-key-id',
          runtimeKey: 'acct-sfx-runtime',
        },
      },
    }));

    try {
      const models = await account.models(true);
      assert.ok(models.some(m => m.id === 'account:elevenlabs-sound-v3' && m.kind === 'audio' && m.mode === 'text-to-audio'));

      // >450-char prompt must fail before submitting any direct account SFX request.
      const tooLong = await api.call('openmotion_capability_run', {
        action: 'run',
        requestId: 'acct-sfx-too-long',
        capabilityId: 'sound-effects',
        model: 'account:elevenlabs-sound-v3',
        prompt: 'x'.repeat(451),
      });
      await gateway.tick();
      await Promise.all([...gateway.active.values()].map(task => task.done));
      const failedState = await api.call('openmotion_job_manage', { action: 'status', jobId: tooLong.job.id });
      assert.equal(failedState.job.state, 'failed');
      assert.match(failedState.job.error ?? '', /450/);
      assert.equal(sfxPosts.length, 0);

      // Valid prompt posts expected payload, polls /audio/tasks/{id}, and completes cleanly.
      const submitted = await api.call('openmotion_capability_run', {
        action: 'run',
        requestId: 'acct-sfx-ok-1',
        capabilityId: 'sound-effects',
        model: 'account:elevenlabs-sound-v3',
        prompt: 'Rain hitting temple bronze bell',
        parameters: { duration_seconds: 3, loop: true, prompt_influence: 0.4 },
      });
      await gateway.tick();
      await Promise.all([...gateway.active.values()].map(task => task.done));
      const completedState = await api.call('openmotion_job_manage', { action: 'status', jobId: submitted.job.id });
      assert.equal(completedState.job.state, 'completed', completedState.job.error);
      assert.equal(sfxPosts.length, 1);
      assert.deepEqual(sfxPosts[0], {
        model: 'elevenlabs-sound-v3',
        parameters: { duration_seconds: 3, loop: true, prompt_influence: 0.4, text: 'Rain hitting temple bronze bell' },
      });

      // Fallback streaming download when AMR omits assets[0].size_bytes completes cleanly and enforces a streaming cap.
      const noSizeSubmitted = await api.call('openmotion_capability_run', {
        action: 'run',
        requestId: 'acct-sfx-ok-nosize',
        capabilityId: 'sound-effects',
        model: 'account:elevenlabs-sound-v3',
        prompt: 'Soft rain on temple roof tiles',
      });
      await gateway.tick();
      await Promise.all([...gateway.active.values()].map(task => task.done));
      const noSizeState = await api.call('openmotion_job_manage', { action: 'status', jobId: noSizeSubmitted.job.id });
      assert.equal(noSizeState.job.state, 'completed', noSizeState.job.error);

      let chunksPulled = 0;
      let streamCancelled = false;
      const endless = new ReadableStream<Uint8Array>({
        pull(controller) {
          chunksPulled += 1;
          controller.enqueue(new Uint8Array(64));
        },
        cancel() {
          streamCancelled = true;
        },
      });
      await assert.rejects(
        () => readCappedBytes(new Response(endless, { status: 200 }), 128),
        /exceeds/i,
      );
      assert.equal(streamCancelled, true);
      assert.ok(chunksPulled <= 4, `expected early stream abort, pulled ${chunksPulled} chunks`);
    } finally {
      account.close();
      await gateway.close();
    }
  }, false));

test('3d-asset aligns with OpenDesign Cloud API + Tripo v3 contract: preset normalization, mutual exclusion, v3 rig defaults, seeds, and extended ops', () =>
  fixture(async store => {
    clearOpenDesign3dDiscoveryCache();
    assert.equal(normalizeTripoAnimation('idle'), 'preset:idle');
    assert.equal(normalizeTripoAnimation('mixamo-slash'), 'preset:slash');
    assert.equal(normalizeTripoAnimation('preset:run'), 'preset:run');
    assert.equal(normalizeTripoAnimation('quadruped:walk'), 'preset:quadruped:walk');
    assert.throws(() => normalizeTripoAnimation('custom_unrecognized_flip'), /preset:\*/);

    const api = service(store);
    const gateway = gatewayFor(store);
    const glbBytes = makeTinyGlb();
    const submitted: any[] = [];
    const downloadedArtifacts: string[] = [];

    gateway.options.pollMs = 10;
    gateway.options.fetcher = (async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/v1/media/models')) {
        return Response.json({ models: [{ model: 'tripo-3.0', kind: '3d_generations', capabilities: {} }] });
      }
      if (url.endsWith('/api/v1/media/3d/tasks') && init?.method === 'POST') {
        const body = JSON.parse(String(init.body ?? '{}'));
        submitted.push(body);
        return Response.json({ task_id: `tripo_${submitted.length}`, status: 'queued' }, { status: 202 });
      }
      if (url.includes('/api/v1/media/3d/tasks/') && url.includes('/content')) {
        downloadedArtifacts.push(url);
        return new Response(glbBytes, { status: 200, headers: { 'Content-Type': 'model/gltf-binary' } });
      }
      if (url.includes('/api/v1/media/3d/tasks/tripo_')) {
        const id = url.split('/').pop()!;
        return Response.json({
          task_id: id,
          status: 'succeeded',
          artifacts: [
            { name: 'base_model', format: 'glb', content_path: `/api/v1/media/3d/tasks/${id}/content?artifact=base_model` },
            { name: 'pbr_model', format: 'glb', content_path: `/api/v1/media/3d/tasks/${id}/content?artifact=pbr_model` },
          ],
        });
      }
      return Response.json({ error: `unexpected ${url}` }, { status: 404 });
    }) as typeof fetch;

    await gateway.configureProvider('opendesign', { apiKey: 'sk-test-opendesign', baseUrl: 'https://amr-mock.example.com', enabled: true });

    try {
      // 1) Bare short names ["idle","run","slash"] normalize to preset:* AND omit conflicting `animation` even when rigPreset is set.
      await api.call('openmotion_capability_run', {
        action: 'run',
        requestId: 'tripo-retarget-bare-names',
        capabilityId: '3d-asset',
        model: 'opendesign:tripo-3.0',
        options: { operation: 'retarget', rigPreset: 'mixamo-idle' },
        parameters: {
          slim: false,
          original_model_task_id: 'rig_task_prior',
          animations: ['idle', 'run', 'slash'],
        },
      });
      assert.equal(submitted.length, 1);
      assert.deepEqual(submitted[0].parameters.animations, ['preset:idle', 'preset:run', 'preset:slash']);
      assert.equal('animation' in submitted[0].parameters, false);
      assert.match(downloadedArtifacts[0], /artifact=pbr_model/);

      // 2) Missing animation or invalid animation on retarget fails fast locally with 0 submissions.
      await assert.rejects(
        api.call('openmotion_capability_run', {
          action: 'run',
          requestId: 'tripo-retarget-no-anim',
          capabilityId: '3d-asset',
          model: 'opendesign:tripo-3.0',
          options: { operation: 'retarget' },
          parameters: { original_model_task_id: 'rig_task_prior' },
        }),
        /requires an animation/,
      );
      await assert.rejects(
        api.call('openmotion_capability_run', {
          action: 'run',
          requestId: 'tripo-retarget-bad-anim',
          capabilityId: '3d-asset',
          model: 'opendesign:tripo-3.0',
          options: { operation: 'retarget' },
          parameters: { original_model_task_id: 'rig_task_prior', animations: ['somersault_xyz'] },
        }),
        /preset:\*/,
      );
      assert.equal(submitted.length, 1);

      // 3) Quadruped rig auto-selects Tripo v3 model_version; mesh forwards model_seed & texture_seed;
      //    OD-documented GLB ops are discoverable and accepted via options.operation, while non-GLB ops fail fast with 0 submissions.
      const described3d = await api.call('openmotion_capability_discover', { action: 'describe', capabilityId: '3d-asset' });
      const opChoices = described3d.capability.input.controls
        .find((c: any) => c.key === 'operation')
        ?.choices.map((c: any) => c.value);
      for (const expectedOp of ['multiview_to_model', 'decimate', 'texture', 'convert', 'segment', 'smartsegment', 'complete', 'uv', 'edit']) {
        assert.ok(opChoices?.includes(expectedOp), `expected 3d-asset discovery to expose operation=${expectedOp}`);
      }

      await api.call('openmotion_capability_run', {
        action: 'run',
        requestId: 'tripo-quadruped-seeds',
        capabilityId: '3d-asset',
        model: 'opendesign:tripo-3.0',
        prompt: 'Armored battle wolf',
        options: { operation: 'rig' },
        parameters: { slim: false, rig_type: 'quadruped', model_seed: 123, texture_seed: 456 },
      });
      assert.equal(submitted[1].parameters.model_seed, 123);
      assert.equal(submitted[1].parameters.texture_seed, 456);
      assert.equal(submitted[2].operation, 'rig');
      assert.equal(submitted[2].parameters.rig_type, 'quadruped');
      assert.equal(submitted[2].parameters.model_version, 'v3.0-20260909');

      await api.call('openmotion_capability_run', {
        action: 'run',
        requestId: 'tripo-segment-op',
        capabilityId: '3d-asset',
        model: 'opendesign:tripo-3.0',
        options: { operation: 'segment' },
        parameters: { slim: false, original_model_task_id: 'tripo_2' },
      });
      assert.equal(submitted[3].operation, 'segment');

      const submittedBeforeRejects = submitted.length;
      for (const nonGlbOp of ['image_to_splat', 'text_to_image', 'rig-check', '/v3/custom']) {
        await assert.rejects(
          api.call('openmotion_capability_run', {
            action: 'run',
            requestId: `tripo-reject-${nonGlbOp.replace(/[^a-z0-9]/gi, '_')}`,
            capabilityId: '3d-asset',
            model: 'opendesign:tripo-3.0',
            parameters: { operation: nonGlbOp, original_model_task_id: 'tripo_2' },
          }),
          /Unsupported 3d-asset operation/,
        );
      }
      await assert.rejects(
        api.call('openmotion_capability_run', {
          action: 'run',
          requestId: 'tripo-reject-non-glb-format',
          capabilityId: '3d-asset',
          model: 'opendesign:tripo-3.0',
          options: { operation: 'convert' },
          parameters: { original_model_task_id: 'tripo_2', out_format: 'fbx' },
        }),
        /GLB outputs/i,
      );
      assert.equal(submitted.length, submittedBeforeRejects, 'non-GLB operations and formats must fail fast before submitting paid tasks');
    } finally {
      await gateway.close();
    }
  }));
