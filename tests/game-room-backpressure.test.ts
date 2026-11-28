import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Duplex } from 'node:stream';
import test, { type TestContext } from 'node:test';
import { attachGameRooms, gameProjectsFor } from '../game-projects.ts';

class MemorySocket extends Duplex {
  blocked = false;
  output: Buffer[] = [];
  upgraded = Promise.withResolvers<void>();
  _read() {}
  _write(chunk: Buffer, _encoding: string, done: (error?: Error) => void) {
    if (this.blocked) return;
    this.output.push(Buffer.from(chunk));
    if (chunk.toString().startsWith('HTTP/1.1 101')) this.upgraded.resolve();
    done();
  }
}

async function connect(t: TestContext) {
  const workspace = await mkdtemp(path.join(tmpdir(), 'game-room-backpressure-'));
  const service = gameProjectsFor(workspace);
  service.templates = path.join(workspace, 'templates');
  service.kits = path.join(workspace, 'kits');
  const { game } = await service.create({ prompt: 'Room transport', multiplayer: true, genre: 'racing', style: null, setting: null });
  const server = createServer(), close = attachGameRooms(server, workspace), socket = new MemorySocket();
  t.after(async () => { close(); socket.destroy(); await rm(workspace, { recursive: true, force: true }); });
  server.emit('upgrade', {
    method: 'GET', url: `/api/games/${game.id}/rooms/backpressure`,
    headers: { host: 'localhost', upgrade: 'websocket', 'sec-websocket-version': '13',
      'sec-websocket-key': Buffer.from('the sample nonce').toString('base64') },
  }, socket, Buffer.alloc(0));
  await socket.upgraded.promise;
  return socket;
}

function receiveControl(socket: Duplex, opcode: number, payload: Buffer) {
  const mask = Buffer.from([1, 2, 3, 4]), masked = Buffer.from(payload);
  for (let index = 0; index < masked.length; index++) masked[index] ^= mask[index % 4];
  socket.emit('data', Buffer.concat([Buffer.from([0x80 | opcode, 0x80 | payload.length]), mask, masked]));
}

for (const [name, opcode, replyOpcode, payload] of [
  ['ping', 9, 10, Buffer.from('keepalive')],
  ['close', 8, 8, Buffer.from([0x03, 0xe8])],
] as const) {
  test(`${name} replies disconnect a client whose outgoing queue is already over budget`, { timeout: 5000 }, async t => {
    const socket = await connect(t);
    socket.blocked = true;
    socket.write(Buffer.alloc(20 * 1024 * 1024));
    assert.equal(socket.writableLength, 20 * 1024 * 1024);
    receiveControl(socket, opcode, payload);
    assert.equal(socket.destroyed, true, 'control replies must respect the existing output queue limit');
  });

  test(`${name} replies preserve the payload for an ordinary client`, { timeout: 5000 }, async t => {
    const socket = await connect(t);
    receiveControl(socket, opcode, payload);
    assert.deepEqual(socket.output.at(-1), Buffer.concat([Buffer.from([0x80 | replyOpcode, payload.length]), payload]));
    assert.equal(socket.writableEnded, opcode === 8);
  });
}
