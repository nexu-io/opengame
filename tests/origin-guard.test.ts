import assert from 'node:assert/strict';
import test from 'node:test';
import { startServer } from '../server.ts';
import { fixture } from './fixtures.ts';

// Some embedded and proxied browsers send `Origin` without the non-default port, which used to
// fail the preview-page guard on every mutating request. The guard still has to reject other
// local ports and foreign origins.
test('preview-page guard accepts a portless loopback origin and rejects foreign ones', () => fixture(async store => {
  const running = await startServer(store, 0, { editor: false });
  const port = (running.server.address() as { port: number }).port;
  const host = `127.0.0.1:${port}`;
  const post = (origin: string | null) => fetch(`http://${host}/api/games/no-such-game/remix`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) },
    body: '{}',
  }).then(response => response.status);
  try {
    assert.equal(await post(`http://${host}`), 404);
    assert.equal(await post('http://127.0.0.1'), 404);
    assert.equal(await post('http://localhost'), 403);
    assert.equal(await post(`http://127.0.0.1:${port + 1}`), 403);
    assert.equal(await post('https://example.com'), 403);
    assert.equal(await post(null), 404);
  } finally {
    await running.close();
  }
}));
