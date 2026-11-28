import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Duplex } from 'node:stream';
import { setImmediate } from 'node:timers/promises';
import { attachGameRooms, gameProjectsFor, starterLogic } from '../game-projects.ts';

class MemorySocket extends Duplex {
  output: Buffer[] = [];
  _read() {}
  _write(chunk: Buffer, _encoding: string, done: (error?: Error) => void) {
    this.output.push(Buffer.from(chunk));
    done();
  }
}

for (const pending of ['get', 'read'] as const) {
  test(`room shutdown cancels an upgrade waiting for ${pending}`, { timeout: 5000 }, async t => {
    const workspace = await mkdtemp(path.join(tmpdir(), 'game-room-shutdown-'));
    t.after(() => rm(workspace, { recursive: true, force: true }));
    const service = gameProjectsFor(workspace);
    service.templates = path.join(workspace, 'templates');
    service.kits = path.join(workspace, 'kits');
    const { game } = await service.create({ prompt: 'Room lifecycle', genre: 'racing', multiplayer: true });
    let entered!: () => void, release!: () => void;
    const waiting = new Promise<void>(resolve => { entered = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    const pause = async () => { entered(); await gate; };
    const get = t.mock.method(service, 'get', async () => {
      if (pending === 'get') await pause();
      return game;
    });
    const read = t.mock.method(service, 'read', async () => {
      if (pending === 'read') await pause();
      return { path: 'logic.js', content: starterLogic };
    });
    const server = createServer(), close = attachGameRooms(server, workspace);
    const socket = new MemorySocket();
    const request = {
      method: 'GET', url: `/api/games/${game.id}/rooms/closing`,
      headers: { host: 'localhost', upgrade: 'websocket', 'sec-websocket-version': '13',
        'sec-websocket-key': Buffer.from('the sample nonce').toString('base64') },
    };
    try {
      server.emit('upgrade', request, socket, Buffer.alloc(0));
      await waiting;
      close();
      assert.equal(socket.destroyed, true, 'pending upgrade sockets must close with the room service');
      release();
      await setImmediate();
      assert.equal(socket.output.length, 0, 'shutdown must not be followed by a successful handshake');
      assert.equal(read.mock.callCount(), pending === 'get' ? 0 : 1);

      const later = new MemorySocket();
      try {
        server.emit('upgrade', request, later, Buffer.alloc(0));
        await setImmediate();
        assert.equal(later.destroyed, true, 'an explicitly closed service must reject later upgrades');
        assert.equal(later.output.length, 0);
        assert.equal(get.mock.callCount(), 1);
      } finally { later.destroy(); }
    } finally {
      release();
      await setImmediate();
      close();
      socket.destroy();
    }
  });
}
