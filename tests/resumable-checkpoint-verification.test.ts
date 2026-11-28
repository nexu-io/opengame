import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { resumableDownload } from '../gateway/resumable-download.ts';

async function fixture(t: TestContext, prefixLength: number, options: {
  shortReads?: boolean; corrupt?: boolean; complete?: boolean; noValidator?: boolean; abortDuringRead?: boolean;
} = {}) {
  const directory = await fs.mkdtemp(path.join(tmpdir(), 'resume-checkpoint-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const bytes = Buffer.alloc(prefixLength + (options.complete ? 0 : 103), 37);
  const prefix = Buffer.from(bytes.subarray(0, prefixLength));
  if (options.corrupt) prefix[prefix.length - 1] ^= 1;
  const partial = path.join(directory, 'image.partial');
  await fs.writeFile(partial, prefix);
  await fs.writeFile(path.join(directory, 'image-download.json'), JSON.stringify({
    assetId: 'original', size: bytes.length, mime: 'image/png', bytes: prefixLength,
    sha256: createHash('sha256').update(bytes.subarray(0, prefixLength)).digest('hex'),
    ...(options.noValidator ? {} : { etag: '"stable"' }),
  }));
  const controller = new AbortController();
  const reason = new Error('cancelled while verifying the saved prefix');
  const originalOpen = fs.open;
  const readRequests: number[] = [];
  fs.open = async (...args) => {
    const handle = await originalOpen(...args);
    if (String(args[0]) === partial) {
      const originalRead = handle.read.bind(handle);
      handle.read = (async (buffer: Buffer, offset: number, length: number, position: number) => {
        readRequests.push(length);
        const result = await originalRead(buffer, offset, options.shortReads ? Math.min(length, 17) : length, position);
        if (options.abortDuringRead) controller.abort(reason);
        return result;
      }) as typeof handle.read;
    }
    return handle;
  };
  syncBuiltinESMExports();
  t.after(() => { fs.open = originalOpen; syncBuiltinESMExports(); });
  const ranges: (string | null)[] = [];
  const run = () => resumableDownload(directory, async () => ({
    assetId: 'original', size: bytes.length, mime: 'image/png', url: 'https://media.example/asset',
  }), controller.signal, async () => {}, async (_url, init) => {
    const headers = new Headers(init.headers);
    const range = headers.get('range');
    ranges.push(range);
    if (range !== null) {
      assert.equal(range, `bytes=${prefixLength}-`);
      assert.equal(headers.get('if-range'), '"stable"');
      return new Response(bytes.subarray(prefixLength), {
        status: 206,
        headers: { etag: '"stable"', 'content-range': `bytes ${prefixLength}-${bytes.length - 1}/${bytes.length}` },
      });
    }
    return new Response(bytes, { headers: { etag: '"stable"' } });
  }, 1);
  return { run, bytes, partial, prefix, ranges, readRequests, reason };
}

test('large saved prefixes are verified with bounded read buffers before resuming', async t => {
  const f = await fixture(t, 2 * 1024 * 1024 + 7);
  assert.deepEqual(await f.run(), f.bytes);
  assert.deepEqual(f.ranges, [`bytes=${f.prefix.length}-`]);
  assert.ok(f.readRequests.length > 1, 'verification must not materialize the complete saved prefix');
  assert.ok(Math.max(...f.readRequests) <= 128 * 1024, 'checkpoint verification exceeds its bounded working buffer');
});

test('valid short filesystem reads preserve the verified Range checkpoint', async t => {
  const f = await fixture(t, 4097, { shortReads: true });
  assert.deepEqual(await f.run(), f.bytes);
  assert.deepEqual(f.ranges, ['bytes=4097-'], 'short reads must not restart a valid saved download');
});

test('cancellation during checkpoint hashing stops before requesting the media', async t => {
  const f = await fixture(t, 2 * 1024 * 1024, { abortDuringRead: true });
  await assert.rejects(f.run(), error => error === f.reason);
  assert.deepEqual(f.ranges, []);
  assert.deepEqual(await fs.readFile(f.partial), f.prefix);
});

test('a mismatch near the end of a multi-buffer prefix restarts from byte zero', async t => {
  const f = await fixture(t, 2 * 1024 * 1024 + 7, { corrupt: true });
  assert.deepEqual(await f.run(), f.bytes);
  assert.deepEqual(f.ranges, [null]);
});

test('a fully verified checkpoint returns the complete file without a network request', async t => {
  const f = await fixture(t, 2 * 1024 * 1024 + 7, { complete: true });
  assert.deepEqual(await f.run(), f.bytes);
  assert.deepEqual(f.ranges, []);
});

test('a prefix without a strong validator still restarts instead of appending', async t => {
  const f = await fixture(t, 4097, { noValidator: true });
  assert.deepEqual(await f.run(), f.bytes);
  assert.deepEqual(f.ranges, [null]);
});
