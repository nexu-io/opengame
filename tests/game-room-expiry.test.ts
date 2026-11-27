import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { attachGameRooms, gameProjectsFor } from '../game-projects.ts';

const logic = `
export const meta = { minPlayers: 1, maxPlayers: 3, tickRate: 60, serverTick: true };
export function setup(ctx, players) {
  return { players: Object.fromEntries(players.map(id => [id, { connected: true }])), expired: [], stamp: 0 };
}
export function validateAction(state, player, action) { return action.type === 'stamp'; }
export function applyAction(state, player, action) {
  if (action.type === 'membership') {
    if (action.expired) { delete state.players[action.player]; state.expired.push(action.player); }
    else state.players[action.player] = { connected: action.connected };
  } else if (action.type === 'stamp') state.stamp = action.value;
  return state;
}
export function isGameOver() { return { over: false }; }
export function viewFor(state) { return state; }
`;

type Message = { type: string; playerId?: string; reconnectToken?: string; view?: any; message?: string };

function inbox(socket: WebSocket) {
  const messages: Message[] = [];
  const waiters: Array<{ match: (message: Message) => boolean; resolve: (message: Message) => void }> = [];
  socket.addEventListener('message', event => {
    const message = JSON.parse(String(event.data)) as Message;
    const index = waiters.findIndex(waiter => waiter.match(message));
    if (index >= 0) waiters.splice(index, 1)[0].resolve(message);
    else messages.push(message);
  });
  return (match: (message: Message) => boolean) => {
    const index = messages.findIndex(match);
    if (index >= 0) return Promise.resolve(messages.splice(index, 1)[0]);
    return new Promise<Message>((resolve, reject) => {
      const waiter = { match, resolve: (message: Message) => { clearTimeout(timer); resolve(message); } };
      const timer = setTimeout(() => {
        const pending = waiters.indexOf(waiter);
        if (pending >= 0) waiters.splice(pending, 1);
        reject(new Error('Room did not send the expected message'));
      }, 3_000);
      waiters.push(waiter);
    });
  };
}

async function fixture(t: TestContext) {
  const workspace = await mkdtemp(path.join(tmpdir(), 'game-room-expiry-'));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const service = gameProjectsFor(workspace);
  service.templates = path.join(workspace, 'templates');
  service.kits = path.join(workspace, 'kits');
  const { game } = await service.create({ prompt: 'Room expiry fixture', multiplayer: true, genre: 'racing', style: null, setting: null });
  await writeFile(path.join(service.root, game.id, 'logic.js'), logic);
  const server = createServer();
  const closeRooms = attachGameRooms(server, workspace);
  t.after(async () => {
    closeRooms();
    await new Promise<void>(resolve => server.close(() => resolve()));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const url = `ws://127.0.0.1:${address.port}/api/games/${game.id}/rooms/expiry`;
  let now = 100_000;
  t.mock.method(Date, 'now', () => now);
  async function connect(token?: string) {
    const socket = new WebSocket(url);
    const next = inbox(socket);
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener('open', () => resolve(), { once: true });
      socket.addEventListener('error', () => reject(new Error('WebSocket connection failed')), { once: true });
    });
    socket.send(JSON.stringify({ type: 'join', ...(token ? { reconnectToken: token } : {}) }));
    const joined = await next(message => message.type === 'joined' || message.type === 'error');
    assert.equal(joined.type, 'joined', joined.message);
    return {
      socket, next, id: joined.playerId!, token: joined.reconnectToken!,
      send: (message: unknown) => socket.send(JSON.stringify(message)),
      close: () => new Promise<void>(resolve => {
        socket.addEventListener('close', () => resolve(), { once: true });
        socket.close();
      }),
      stateAfter: async (value: number) => {
        socket.send(JSON.stringify({ type: 'input', action: { type: 'stamp', value } }));
        return (await next(message => message.type === 'state' && message.view.stamp === value)).view;
      },
    };
  }
  return { connect, setTime: (value: number) => { now = value; } };
}

test('a running room expires disconnected membership without another join', async t => {
  const { connect, setTime } = await fixture(t);
  const active = await connect(), leaving = await connect();
  active.send({ type: 'start' });
  await active.next(message => message.type === 'state');
  await leaving.close();
  await active.next(message => message.type === 'state' && message.view.players[leaving.id]?.connected === false);

  setTime(129_999);
  const reserved = await active.stateAfter(1);
  assert.equal(reserved.players[leaving.id].connected, false);
  assert.deepEqual(reserved.expired, []);

  setTime(130_000);
  const expired = await active.stateAfter(2);
  assert.equal(expired.players[leaving.id], undefined, 'The expired player must leave the simulation without waiting for a join');
  assert.deepEqual(expired.expired, [leaving.id]);
  assert.equal(expired.players[active.id].connected, true);

  setTime(200_000);
  assert.deepEqual((await active.stateAfter(3)).expired, [leaving.id], 'Expire each reservation only once');
});

test('reconnecting within the grace period keeps the identity active beyond its former expiry', async t => {
  const { connect, setTime } = await fixture(t);
  const active = await connect(), leaving = await connect();
  active.send({ type: 'start' });
  await active.next(message => message.type === 'state');
  await leaving.close();
  await active.next(message => message.type === 'state' && message.view.players[leaving.id]?.connected === false);

  setTime(129_999);
  const reconnected = await connect(leaving.token);
  assert.equal(reconnected.id, leaving.id);
  assert.equal(reconnected.token, leaving.token);
  setTime(200_000);
  const state = await active.stateAfter(1);
  assert.equal(state.players[leaving.id].connected, true);
  assert.deepEqual(state.expired, []);
});
