import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';
import { ContentBatchService, type BatchExecutionHost } from '../gateway/content-batch.ts';
import { designProjectsFor } from '../design-projects.ts';
import { ScenarioRuns, scenarioOperation, type ScenarioHost } from '../gateway/scenario-runs.ts';
import { startServer } from '../server.ts';
import { BATCH_RECIPES, CONTENT_BATCH_API } from '../shared/content-batch.ts';
import { MCP_HTTP_PATH } from '../shared/mcp-http.ts';
import { fixture } from './fixtures.ts';

test('ContentBatchService runs mcp-pipeline concurrently, retries failed items, and exports a ZIP bundle', () =>
  fixture(async store => {
    const service = new ContentBatchService(store.directory);
    let failOnce = true;

    const host = {
      callMcpTool: async (_tool: string, args: Record<string, unknown>) => {
        if (args.title === 'Variant B' && failOnce) {
          failOnce = false;
          throw new Error('Transient render error');
        }
        return { projectId: `proj-${String(args.title)}`, revision: 'r1' };
      },
      runAgentOptimization: async (_batch: any, item: any) => ({
        chatId: `chat-${item.id}`,
        summary: `Polished ${item.label}`,
      }),
    };

    try {
      const { batch } = await service.create(
        {
          title: 'Product Launch Variants',
          mode: 'mcp-pipeline',
          concurrency: 2,
          sharedVariables: { brand: 'OpenMotion' },
          pipeline: [
            {
              id: 'create',
              tool: 'openmotion_create_project',
              arguments: {
                title: '{{item.variables.headline}}',
                brand: '{{shared.brand}}',
              },
            },
          ],
          items: [
            { id: 'v1', label: 'Variant A', variables: { headline: 'Variant A' } },
            { id: 'v2', label: 'Variant B', variables: { headline: 'Variant B' } },
            { id: 'v3', label: 'Variant C', variables: { headline: 'Variant C' } },
          ],
          autoStart: true,
          wait: true,
        },
        host,
      );

      assert.equal(batch.state, 'partial');
      assert.equal(batch.counts.completed, 2);
      assert.equal(batch.counts.failed, 1);

      const retried = await service.retryFailed(batch.id, host, { wait: true });
      assert.equal(retried.state, 'completed');
      assert.equal(retried.counts.completed, 3);
      assert.equal(retried.counts.failed, 0);

      const bundle = await service.exportBundle(batch.id);
      assert.ok(bundle.bytes > 0);
      assert.equal(bundle.entries, 5); // manifest + summary + 3 items
      assert.ok(existsSync(bundle.archivePath));
    } finally {
      await service.close();
    }
  }));

test('Batch optimization works identically via HTTP routes and openmotion_assets_use action=batch over MCP', () =>
  fixture(async store => {
    const running = await startServer(store, 0, { editor: false });
    const port = (running.server.address() as { port: number }).port;
    const origin = `http://127.0.0.1:${port}`;

    try {
      // Create & run a batch via openmotion_assets_use MCP tool over /mcp
      const mcpRes = await fetch(`${origin}${MCP_HTTP_PATH}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'openmotion_assets_use',
            arguments: {
              action: 'batch',
              batch: {
                command: 'create',
                title: 'MCP Batch Catalog Sync',
                mode: 'mcp-pipeline',
                concurrency: 2,
                autoStart: true,
                wait: true,
                pipeline: [
                  { id: 'list', tool: 'openmotion_get_project', arguments: {} },
                ],
                items: [
                  { id: 'a1', label: 'Region US' },
                  { id: 'a2', label: 'Region JP' },
                ],
              },
            },
          },
        }),
      });
      assert.equal(mcpRes.status, 200);
      const mcpPayload = (await mcpRes.json()) as any;
      const createdBatch = mcpPayload.result.structuredContent.batch;
      assert.equal(createdBatch.state, 'completed');
      assert.equal(createdBatch.counts.completed, 2);

      // List & export the same batch through Studio HTTP endpoints
      const listRes = await fetch(`${origin}${CONTENT_BATCH_API}`);
      assert.equal(listRes.status, 200);
      const listData = (await listRes.json()) as any;
      assert.ok(listData.batches.some((item: any) => item.id === createdBatch.id));

      const exportRes = await fetch(`${origin}${CONTENT_BATCH_API}/${createdBatch.id}/export`, {
        method: 'POST',
        headers: { Origin: origin, 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      assert.equal(exportRes.status, 200);
      const exportData = (await exportRes.json()) as any;
      assert.match(exportData.bundle.downloadUrl, /\/bundles\/[a-f0-9-]+\/file$/);

      const zipRes = await fetch(`${origin}${exportData.bundle.downloadUrl}`);
      assert.equal(zipRes.status, 200);
      assert.equal(zipRes.headers.get('content-type'), 'application/zip');
    } finally {
      await running.close();
    }
  }));

function scenarioBatchFixture(run: (context: {
  service: ContentBatchService;
  scenarios: ScenarioRuns;
  host: BatchExecutionHost;
  design: ReturnType<typeof designProjectsFor>;
  motionRequests: Record<string, unknown>[];
}) => Promise<void>) {
  return fixture(async store => {
    const service = new ContentBatchService(store.directory);
    const scenarios = new ScenarioRuns(store.directory, store);
    const design = designProjectsFor(store.directory);
    const motionRequests: Record<string, unknown>[] = [];
    const scenarioHost: ScenarioHost = {
      origin: () => 'http://localhost',
      design,
      resolveAsset: async () => null,
      assets: async () => { throw new Error('Unexpected media generation'); },
      createMotionProject: async input => {
        motionRequests.push(input);
        const projectId = '11111111-1111-4111-8111-' + String(motionRequests.length).padStart(12, '0');
        return { projectId, sessionId: null, previewUrl: 'http://localhost/editor/' + projectId };
      },
      exportMotionArchive: async () => { throw new Error('Unexpected Motion export'); },
    };
    const host: BatchExecutionHost = {
      callMcpTool: async (tool, args) => {
        assert.equal(tool, 'openmotion_assets_use');
        assert.equal(args.action, 'scenario');
        return scenarioOperation(scenarios, args.scenario, scenarioHost);
      },
      runAgentOptimization: async () => { throw new Error('Unexpected agent dispatch'); },
    };
    try {
      await run({ service, scenarios, host, design, motionRequests });
    } finally {
      await service.close();
    }
  });
}

test('scenario matrix campaign recipe creates real starter pages for all sample items', () =>
  scenarioBatchFixture(async ({ service, scenarios, host, design }) => {
    const recipe = BATCH_RECIPES.find(item => item.id === 'campaign-scenario-batch')!;
    const { batch } = await service.create({
      title: 'Campaign recipe',
      mode: 'scenario-matrix',
      recipeId: recipe.id,
      items: structuredClone(recipe.sampleItems),
      autoStart: true,
      wait: true,
    }, host);
    assert.equal(batch.state, 'completed', JSON.stringify(batch.items));
    assert.equal(batch.counts.completed, recipe.sampleItems.length);
    for (const item of batch.items) {
      const runId = item.outputs.find(output => output.kind === 'scenario-run')?.runId;
      assert.ok(runId);
      const { run } = await scenarios.get(runId);
      assert.equal(run.scenarioId, 'design-full-chain');
      const pageId = run.steps['landing-page'].links.designProjectId;
      assert.ok(pageId);
      assert.ok(item.outputs.some(output => output.kind === 'design-project' && output.id === pageId));
      assert.match((await design.readFile(pageId, 'index.html')).content, /OpenMotion Pro/);
    }
  }));

test('scenario matrix preserves typed briefs and creates linked page and Motion outputs', () =>
  scenarioBatchFixture(async ({ service, scenarios, host, motionRequests }) => {
    const label = 'a'.repeat(119) + '🎮';
    const { batch } = await service.create({
      title: 'Typed scenario inputs',
      mode: 'scenario-matrix',
      scenarioConfig: { scenarioId: 'design-full-chain', createPage: true, createMotion: true },
      items: [{
        label,
        prompt: 'Launch an accessible editing toolkit',
        variables: { productName: 'Toolkit', valueProps: ['Keyboard controls', 'Clear typography'] },
      }],
      autoStart: true,
      wait: true,
    }, host);
    assert.equal(batch.state, 'completed', JSON.stringify(batch.items));
    const item = batch.items[0];
    const { run } = await scenarios.get(item.outputs.find(output => output.kind === 'scenario-run')!.runId!);
    assert.equal(run.title, 'a'.repeat(119));
    assert.deepEqual(run.brief.valueProps, ['Keyboard controls', 'Clear typography']);
    assert.equal(run.brief.idea, 'Launch an accessible editing toolkit');
    assert.equal(run.revision, 3);
    assert.equal(motionRequests.length, 1);
    assert.equal(motionRequests[0].projectType, 'natural_language');
    assert.equal(String(motionRequests[0].title).length, 100);
    assert.ok(item.outputs.some(output => output.kind === 'motion-project'
      && output.id === run.steps['promo-video'].links.motionProjectId));
    assert.ok(item.outputs.some(output => output.kind === 'design-project'
      && output.id === run.steps['landing-page'].links.designProjectId));
  }));

test('scenario matrix rejects unsupported page creation before leaving a scenario run', () =>
  scenarioBatchFixture(async ({ service, scenarios, host }) => {
    const { batch } = await service.create({
      title: 'Unsupported page target',
      mode: 'scenario-matrix',
      scenarioConfig: { scenarioId: 'motion-full-chain', createPage: true },
      items: [{ label: 'Variant' }],
      autoStart: true,
      wait: true,
    }, host);
    assert.equal(batch.state, 'failed');
    assert.match(batch.items[0].error ?? '', /no page creation step/);
    assert.equal((await scenarios.list()).runs.length, 0);
  }));

test('scenario matrix cancellation stops subsequent mutations after an in-flight call', () =>
  scenarioBatchFixture(async ({ service, scenarios, host }) => {
    let releaseCreate!: () => void;
    let created!: () => void;
    const createGate = new Promise<void>(resolve => { releaseCreate = resolve; });
    const enteredCreate = new Promise<void>(resolve => { created = resolve; });
    const commands: string[] = [];
    const pausedHost: BatchExecutionHost = {
      ...host,
      callMcpTool: async (tool, args) => {
        const command = (args.scenario as { command: string }).command;
        commands.push(command);
        const result = await host.callMcpTool(tool, args);
        if (command === 'create') {
          created();
          await createGate;
        }
        return result;
      },
    };
    try {
      const { batch } = await service.create({
        title: 'Cancel scenario dispatch',
        mode: 'scenario-matrix',
        scenarioConfig: { scenarioId: 'design-full-chain', createPage: true },
        items: [{ label: 'Variant', variables: { productName: 'Toolkit' } }],
      });
      const running = service.start(batch.id, pausedHost, { wait: true });
      await enteredCreate;
      const cancelled = service.cancel(batch.id);
      releaseCreate();
      await cancelled;
      const final = await running;
      assert.equal(final.state, 'cancelled');
      assert.deepEqual(commands, ['create']);
      const runId = final.items[0].outputs.find(output => output.kind === 'scenario-run')!.runId!;
      assert.deepEqual((await scenarios.get(runId)).run.brief, { productName: 'Toolkit' });
    } finally {
      releaseCreate();
    }
  }));


test('scenario matrix validates briefs before creating runs: scalar arrays remain compatible', () =>
  scenarioBatchFixture(async ({ service, scenarios, host }) => {
    const { batch } = await service.create({
      title: 'Scalar array brief', mode: 'scenario-matrix',
      scenarioConfig: { scenarioId: 'design-full-chain', createPage: true },
      items: [{ label: 'Audience variant', variables: {
        productName: 'Toolkit', audience: ['Designers', 'Marketers'], valueProps: ['Fast', 'Accessible'],
      } }],
      autoStart: true, wait: true,
    }, host);
    assert.equal(batch.state, 'completed', JSON.stringify(batch.items));
    const { runs } = await scenarios.list();
    assert.equal(runs.length, 1);
    const { run } = await scenarios.get(runs[0].id);
    assert.equal(run.brief.audience, 'Designers,Marketers');
    assert.deepEqual(run.brief.valueProps, ['Fast', 'Accessible']);
    assert.equal(run.revision, 2);
  }));

for (const [label, variables, message] of [
  ['unknown fields', { unsupportedField: 'unused' }, /Unknown brief field/],
  ['invalid list values', { valueProps: 'must be a list' }, /must be an array/],
] as const) {
  test('scenario matrix validates briefs before creating runs: ' + label, () =>
    scenarioBatchFixture(async ({ service, scenarios, host, design }) => {
      const { batch } = await service.create({
        title: 'Invalid brief', mode: 'scenario-matrix',
        scenarioConfig: { scenarioId: 'design-full-chain', createPage: true },
        items: [{ label: 'Invalid variant', variables }],
        autoStart: true, wait: true,
      }, host);
      assert.equal(batch.state, 'failed');
      assert.match(batch.items[0].error ?? '', message);
      assert.equal((await scenarios.list()).runs.length, 0);
      assert.equal((await design.list()).length, 0);
      assert.deepEqual(batch.items[0].outputs, []);
    }));
}
