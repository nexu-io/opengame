import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { setImmediate } from 'node:timers/promises';
import test from 'node:test';
import { resolvePublicAddresses, type PublicAddress } from '../gateway/network.ts';

const publicAddresses: PublicAddress[] = [{ address: '93.184.216.34', family: 4 }];

test('already-cancelled provider resolution never starts a DNS lookup', async () => {
  const controller = new AbortController(), reason = new Error('Cancelled before lookup');
  controller.abort(reason);
  let calls = 0;
  await assert.rejects(resolvePublicAddresses('provider.example', controller.signal, undefined, {
    lookup: async () => { calls++; return publicAddresses; },
    publicDns: async () => { throw new Error('Unexpected public DNS fallback'); },
  }), error => error === reason);
  assert.equal(calls, 0);
});

test('already-cancelled literal addresses retain the cancellation reason', async () => {
  const controller = new AbortController(), reason = new Error('Cancelled literal');
  controller.abort(reason);
  await assert.rejects(resolvePublicAddresses('93.184.216.34', controller.signal), error => error === reason);
});

for (const lateResult of ['resolve', 'reject'] as const) {
  test(`cancellation settles while system DNS is pending and tolerates its late ${lateResult}`, async () => {
    const controller = new AbortController(), reason = new Error('Cancelled during lookup');
    const lookup = Promise.withResolvers<PublicAddress[]>();
    let fallbacks = 0;
    const resolution = resolvePublicAddresses('provider.example', controller.signal, undefined, {
      lookup: () => lookup.promise,
      publicDns: async () => { fallbacks++; return publicAddresses; },
    });
    const result = resolution.then(value => ({ value }), error => ({ error }));
    controller.abort(reason);
    try {
      // DNS is deliberately unresolved until finally. An event-loop turn is
      // only a failure boundary; no real resolver speed decides the assertion.
      const outcome = await Promise.race([result, setImmediate('still waiting for DNS')]);
      assert.deepEqual(outcome, { error: reason });
      assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
    } finally {
      if (lateResult === 'resolve') lookup.resolve([{ address: '198.18.0.1', family: 4 }]);
      else lookup.reject(new Error('Late resolver failure'));
      await result;
      await setImmediate();
    }
    assert.equal(fallbacks, 0, 'cancellation must not start a fallback request');
  });
}

test('successful DNS resolution releases its abort listener and preserves pinned answers', async () => {
  const controller = new AbortController();
  const result = await resolvePublicAddresses('provider.example', controller.signal, undefined, {
    lookup: async () => publicAddresses,
    publicDns: async () => { throw new Error('Unexpected public DNS fallback'); },
  });
  assert.deepEqual(result, publicAddresses);
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  controller.abort(new Error('Cancelled after resolution'));
  assert.deepEqual(result, publicAddresses);
});

test('DNS failures preserve the original error and release the abort listener', async () => {
  const controller = new AbortController(), failure = Object.assign(new Error('No DNS answer'), { code: 'ENOTFOUND' });
  await assert.rejects(resolvePublicAddresses('provider.example', controller.signal, undefined, {
    lookup: async () => { throw failure; },
    publicDns: async () => { throw new Error('Unexpected public DNS fallback'); },
  }), error => error === failure);
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
});
