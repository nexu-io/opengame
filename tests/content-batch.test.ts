import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';
import { ContentBatchService } from '../gateway/content-batch.ts';
import { startServer } from '../server.ts';
import { CONTENT_BATCH_API } from '../shared/content-batch.ts';
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

test('concurrent batch starts share one initialization and worker pool', t =>
  fixture(async store => {
    const service = new ContentBatchService(store.directory);
    const { batch } = await service.create({
      title: 'Start once',
      mode: 'mcp-pipeline',
      pipeline: [{ id: 'inspect', tool: 'openmotion_get_project', arguments: {} }],
      items: [{ label: 'Variant' }],
    });
    let releasePool!: () => void;
    const poolGate = new Promise<void>(resolve => { releasePool = resolve; });
    const runPool = (service as any).runPool.bind(service);
    let poolStarts = 0;
    let toolCalls = 0;
    t.mock.method(service as any, 'runPool', async (...args: any[]) => {
      poolStarts++;
      await poolGate;
      return runPool(...args);
    });
    const host = {
      callMcpTool: async () => { toolCalls++; return { projectId: 'variant' }; },
      runAgentOptimization: async () => ({ chatId: 'unused' }),
    };
    try {
      const initial = await Promise.all([
        service.start(batch.id, host),
        service.start(batch.id, host),
        service.start(batch.id, host),
      ]);
      assert.deepEqual(initial.map(job => job.state), ['running', 'running', 'running']);
      assert.equal(poolStarts, 1);
      const finished = service.start(batch.id, host, { wait: true });
      releasePool();
      const completed = await finished;
      assert.equal(completed.state, 'completed');
      assert.equal(completed.counts.completed, 1);
      assert.equal(toolCalls, 1);
    } finally {
      releasePool();
      await service.close();
    }
  }));

test('cancelling a batch during initialization prevents tool execution', t =>
  fixture(async store => {
    const service = new ContentBatchService(store.directory);
    const { batch } = await service.create({
      title: 'Cancel before dispatch',
      mode: 'mcp-pipeline',
      pipeline: [{ id: 'inspect', tool: 'openmotion_get_project', arguments: {} }],
      items: [{ label: 'Variant' }],
    });
    let releaseSave!: () => void;
    let saving!: () => void;
    const saveGate = new Promise<void>(resolve => { releaseSave = resolve; });
    const enteredSave = new Promise<void>(resolve => { saving = resolve; });
    const saveJob = (service as any).saveJobLocked.bind(service);
    let firstSave = true;
    t.mock.method(service as any, 'saveJobLocked', async (job: any) => {
      if (firstSave) {
        firstSave = false;
        saving();
        await saveGate;
      }
      return saveJob(job);
    });
    let toolCalls = 0;
    const host = {
      callMcpTool: async () => { toolCalls++; return {}; },
      runAgentOptimization: async () => ({ chatId: 'unused' }),
    };
    try {
      const started = service.start(batch.id, host, { wait: true });
      await enteredSave;
      const cancelled = service.cancel(batch.id);
      releaseSave();
      const results = await Promise.all([started, cancelled]);
      assert.ok(results.every(job => job.state === 'cancelled'));
      assert.equal((await service.get(batch.id)).counts.cancelled, 1);
      assert.equal(toolCalls, 0);
    } finally {
      releaseSave();
      await service.close();
    }
  }));

test('a failed batch initialization releases its execution record for retry', t =>
  fixture(async store => {
    const service = new ContentBatchService(store.directory);
    const { batch } = await service.create({
      title: 'Retry initialization',
      mode: 'mcp-pipeline',
      pipeline: [{ id: 'inspect', tool: 'openmotion_get_project', arguments: {} }],
      items: [{ label: 'Variant' }],
    });
    const loadJob = (service as any).loadJob.bind(service);
    let failOnce = true;
    t.mock.method(service as any, 'loadJob', async (id: string) => {
      if (failOnce) {
        failOnce = false;
        throw new Error('Temporary storage error');
      }
      return loadJob(id);
    });
    let toolCalls = 0;
    const host = {
      callMcpTool: async () => { toolCalls++; return {}; },
      runAgentOptimization: async () => ({ chatId: 'unused' }),
    };
    try {
      await assert.rejects(service.start(batch.id, host), /Temporary storage error/);
      const completed = await service.start(batch.id, host, { wait: true });
      assert.equal(completed.state, 'completed');
      assert.equal(toolCalls, 1);
    } finally {
      await service.close();
    }
  }));

test('batch initialization failure still persists cancellation', async t => {
  for (const persisted of [false, true]) {
    await t.test(persisted ? 'job saved before index failure' : 'initial write failed', subtest =>
      fixture(async store => {
        const service = new ContentBatchService(store.directory);
        const { batch } = await service.create({
          title: 'Cancel failed initialization',
          mode: 'mcp-pipeline',
          pipeline: [{ id: 'inspect', tool: 'openmotion_get_project', arguments: {} }],
          items: [{ label: 'Variant' }],
        });
        let releaseSave!: () => void;
        let saving!: () => void;
        const saveGate = new Promise<void>(resolve => { releaseSave = resolve; });
        const enteredSave = new Promise<void>(resolve => { saving = resolve; });
        const saveJob = (service as any).saveJobLocked.bind(service);
        let firstSave = true;
        subtest.mock.method(service as any, 'saveJobLocked', async (job: any) => {
          if (firstSave) {
            firstSave = false;
            if (persisted) await saveJob(job);
            saving();
            await saveGate;
            throw new Error('Initialization persistence failed');
          }
          return saveJob(job);
        });
        subtest.mock.method(console, 'error', () => {});
        let toolCalls = 0;
        const host = {
          callMcpTool: async () => { toolCalls++; return {}; },
          runAgentOptimization: async () => ({ chatId: 'unused' }),
        };
        try {
          const started = service.start(batch.id, host, { wait: true });
          const rejected = assert.rejects(started, /Initialization persistence failed/);
          await enteredSave;
          const cancellation = service.cancel(batch.id);
          releaseSave();
          await rejected;
          const cancelled = await cancellation;
          assert.equal(cancelled.state, 'cancelled');
          assert.equal(cancelled.counts.cancelled, 1);
          assert.equal((await service.get(batch.id)).state, 'cancelled');
          assert.equal(toolCalls, 0);
        } finally {
          releaseSave();
          await service.close();
        }
      }));
  }
});

test('background batch failure logs the batch ID and storage error', t =>
  fixture(async store => {
    const service = new ContentBatchService(store.directory);
    const { batch } = await service.create({
      title: 'Observe worker failure',
      mode: 'mcp-pipeline',
      pipeline: [{ id: 'inspect', tool: 'openmotion_get_project', arguments: {} }],
      items: [{ label: 'Variant' }],
    });
    let releaseWorker!: () => void;
    const workerGate = new Promise<void>(resolve => { releaseWorker = resolve; });
    const failure = new Error('Worker state lock timed out');
    t.mock.method(service as any, 'updateItemState', async () => {
      await workerGate;
      throw failure;
    });
    const logged: unknown[][] = [];
    t.mock.method(console, 'error', (...args: unknown[]) => { logged.push(args); });
    const host = {
      callMcpTool: async () => { assert.fail('the failed state write must prevent dispatch'); },
      runAgentOptimization: async () => ({ chatId: 'unused' }),
    };
    try {
      assert.equal((await service.start(batch.id, host)).state, 'running');
      const finished = (service as any).activeExecutions.get(batch.id).finished as Promise<unknown>;
      const rejected = assert.rejects(finished, /Worker state lock timed out/);
      releaseWorker();
      await rejected;
      assert.equal(logged.length, 1);
      assert.equal(logged[0][0], `[content-batch] Batch ${batch.id} execution failed:`);
      assert.equal(logged[0][1], failure);
    } finally {
      releaseWorker();
      await service.close();
    }
  }));
