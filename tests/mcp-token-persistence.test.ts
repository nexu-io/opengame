import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { McpTokenStore } from '../gateway/mcp-http.ts';

const endpoint = 'http://127.0.0.1:4040/mcp';

async function fixture(t: TestContext) {
  const directory = await fs.mkdtemp(path.join(tmpdir(), 'mcp-token-persistence-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = new McpTokenStore(directory);
  const existing = await store.create('existing', 'read', endpoint);
  return { directory, store, existing };
}

async function blockPublication(store: McpTokenStore) {
  const backup = store.file + '.saved';
  await fs.rename(store.file, backup);
  await fs.mkdir(store.file);
  return async () => {
    await fs.rm(store.file, { recursive: true });
    await fs.rename(backup, store.file);
  };
}

test('a failed token creation is not exposed by the cached token list', async t => {
  const { store, existing } = await fixture(t);
  await blockPublication(store);
  await assert.rejects(store.create('not saved', 'admin', endpoint));
  assert.deepEqual((await store.list()).map(token => token.id), [existing.summary.id]);
});

test('a failed revocation retains the previously committed token state', async t => {
  const { store, existing } = await fixture(t);
  await blockPublication(store);
  await assert.rejects(store.revoke(existing.summary.id));
  assert.deepEqual((await store.list()).map(token => token.id), [existing.summary.id]);
});

test('retrying after a failed write does not persist a phantom earlier token', async t => {
  const { store, directory } = await fixture(t);
  const restore = await blockPublication(store);
  await assert.rejects(store.create('failed attempt', 'write', endpoint));
  await restore();
  await store.create('successful retry', 'write', endpoint);
  assert.deepEqual((await new McpTokenStore(directory).list()).map(token => token.label), ['successful retry', 'existing']);
});

test('readers see committed tokens while an atomic rename is still pending', async t => {
  const { store, existing } = await fixture(t);
  const originalRename = fs.rename;
  let started!: () => void, release!: () => void;
  const atRename = new Promise<void>(resolve => { started = resolve; });
  const released = new Promise<void>(resolve => { release = resolve; });
  fs.rename = async (...args) => {
    if (String(args[1]) === store.file) { started(); await released; }
    return originalRename(...args);
  };
  syncBuiltinESMExports();
  const creating = store.create('pending token', 'write', endpoint);
  try {
    await atRename;
    assert.deepEqual((await store.list()).map(token => token.id), [existing.summary.id]);
  } finally {
    release();
    try { await creating; }
    finally { fs.rename = originalRename; syncBuiltinESMExports(); }
  }
  assert.equal((await store.list()).length, 2);
});

test('serialized successful writes preserve all tokens and durable revocations', async t => {
  const { store, directory, existing } = await fixture(t);
  const created = await Promise.all(Array.from({ length: 8 }, (_, i) => store.create(`client ${i}`, 'write', endpoint)));
  assert.equal((await store.list()).length, 9);
  await store.revoke(existing.summary.id);
  const reloaded = new McpTokenStore(directory);
  assert.deepEqual(new Set((await reloaded.list()).map(token => token.id)), new Set(created.map(token => token.summary.id)));
  await assert.rejects(reloaded.verify(`Bearer ${existing.token}`), /Invalid MCP Bearer token/);
});
