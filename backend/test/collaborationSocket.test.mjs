import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import express from 'express';
import test from 'node:test';
import WebSocket from 'ws';
import * as Y from 'yjs';
import { attachCollaborationWebSocket, createCollaborationRouter } from '../lib/collaboration.mjs';

const usersByToken = {
  tokenA: { id: 'user-a', email: 'a@example.test', user_metadata: { name: 'Ada' } },
  tokenB: { id: 'user-b', email: 'b@example.test', user_metadata: { name: 'Bea' } },
  tokenC: { id: 'user-c', email: 'c@example.test', user_metadata: { name: 'Cy' } },
};

const createSupabaseMock = () => {
  const rooms = new Map();
  const members = new Map();
  const keyForMember = (roomId, userId) => `${roomId}:${userId}`;

  const supabase = {
    auth: {
      getUser: async (token) => usersByToken[token]
        ? { data: { user: usersByToken[token] }, error: null }
        : { data: { user: null }, error: new Error('Invalid token') },
    },
    from(table) {
      let action = 'select';
      let payload;
      const filters = {};
      const builder = {
        select() { action = 'select'; return builder; },
        insert(value) { action = 'insert'; payload = value; return builder; },
        upsert(value) { action = 'upsert'; payload = value; return builder; },
        update(value) { action = 'update'; payload = value; return builder; },
        delete() { action = 'delete'; return builder; },
        eq(field, value) { filters[field] = value; return builder; },
        maybeSingle() { return execute(true); },
        then(resolve, reject) { return execute(false).then(resolve, reject); },
      };

      const matches = (row) => Object.entries(filters).every(([field, value]) => row?.[field] === value);
      const execute = async (single) => {
        const rows = table === 'collaboration_rooms' ? rooms : members;
        if (action === 'insert') {
          const row = { ...payload };
          if (table === 'collaboration_rooms') rooms.set(row.id, row);
          else members.set(keyForMember(row.room_id, row.user_id), row);
          return { data: row, error: null };
        }
        if (action === 'upsert') {
          const key = keyForMember(payload.room_id, payload.user_id);
          const row = { ...members.get(key), ...payload };
          members.set(key, row);
          return { data: row, error: null };
        }
        const found = [...rows.values()].filter(matches);
        if (action === 'select') return { data: single ? found[0] || null : found, error: null };
        if (action === 'update') {
          for (const row of found) Object.assign(row, payload);
          return { data: found, error: null };
        }
        if (action === 'delete') {
          for (const row of found) {
            if (table === 'collaboration_rooms') rooms.delete(row.id);
            else members.delete(keyForMember(row.room_id, row.user_id));
          }
          return { data: found, error: null };
        }
        return { data: null, error: null };
      };
      return builder;
    },
  };
  return { supabase, rooms };
};

const waitForMessage = (client, predicate, description) => {
  const existing = client.messages.find(predicate);
  if (existing) return Promise.resolve(existing);
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${description}; got ${client.messages.map(({ type }) => type).join(', ')}.`)), 3000);
    const onMessage = (raw) => {
      const message = JSON.parse(raw.toString());
      if (!predicate(message)) return;
      clearTimeout(timeout);
      client.socket.off('message', onMessage);
      resolve(message);
    };
    client.socket.on('message', onMessage);
  });
};

const connectClient = (url, roomId, token) => new Promise((resolve, reject) => {
  const socket = new WebSocket(url, { headers: { origin: 'http://localhost:8080' } });
  const client = { socket, document: new Y.Doc(), messages: [] };
  socket.on('message', (raw) => {
    const message = JSON.parse(raw.toString());
    client.messages.push(message);
    if (message.type === 'sync') Y.applyUpdate(client.document, Buffer.from(message.update, 'base64'));
  });
  socket.on('open', () => socket.send(JSON.stringify({ type: 'authenticate', roomId, accessToken: token })));
  socket.on('message', (raw) => {
    const message = JSON.parse(raw.toString());
    if (message.type === 'sync') resolve(client);
  });
  socket.on('error', reject);
});

const closeClient = (client) => new Promise((resolve) => {
  if (client.socket.readyState === WebSocket.CLOSED) return resolve();
  client.socket.once('close', resolve);
  client.socket.close();
});

test('authenticated clients sync only within their joined room and reconnect from saved state', async (t) => {
  const { supabase, rooms } = createSupabaseMock();
  const app = express();
  app.use(express.json());
  app.use('/api/collaboration', createCollaborationRouter({ supabase }));
  const server = createServer(app);
  attachCollaborationWebSocket({ server, supabase, isAllowedOrigin: () => true });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const apiBase = `http://127.0.0.1:${address.port}`;
  const socketUrl = `ws://127.0.0.1:${address.port}/collaboration`;
  const clients = [];
  t.after(async () => {
    await Promise.all(clients.map(closeClient));
    await new Promise((resolve) => server.close(resolve));
  });

  const createRoom = async (token) => {
    const response = await fetch(`${apiBase}/api/collaboration/rooms`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ language: 'javascript' }),
    });
    assert.equal(response.status, 201);
    return response.json();
  };

  const firstRoom = await createRoom('tokenA');
  assert.equal(rooms.get(firstRoom.room.id).room_code, firstRoom.room.id);
  const otherRoom = await createRoom('tokenA');
  assert.equal(rooms.get(otherRoom.room.id).room_code, otherRoom.room.id);
  const joinResponse = await fetch(`${apiBase}/api/collaboration/rooms/${firstRoom.room.id}/join`, {
    method: 'POST',
    headers: { authorization: 'Bearer tokenB', 'content-type': 'application/json' },
    body: JSON.stringify({ inviteCode: firstRoom.inviteCode }),
  });
  assert.equal(joinResponse.status, 200);

  const forbidden = await fetch(`${apiBase}/api/collaboration/rooms/${firstRoom.room.id}`, {
    headers: { authorization: 'Bearer tokenC' },
  });
  assert.equal(forbidden.status, 403);

  const owner = await connectClient(socketUrl, firstRoom.room.id, 'tokenA');
  clients.push(owner);
  const invitedMember = await connectClient(socketUrl, firstRoom.room.id, 'tokenB');
  clients.push(invitedMember);
  const otherRoomClient = await connectClient(socketUrl, otherRoom.room.id, 'tokenA');
  clients.push(otherRoomClient);

  const participants = await waitForMessage(owner, (message) => message.type === 'participants' && message.participants.length === 2, 'two participants');
  assert.equal(participants.participants.filter((participant) => participant.isSelf).length, 1);

  const updateArrived = waitForMessage(invitedMember, (message) => message.type === 'update', 'shared update');
  const otherRoomUpdate = waitForMessage(otherRoomClient, (message) => message.type === 'update', 'cross-room update').then(() => true, () => false);
  const vector = Y.encodeStateVector(owner.document);
  owner.document.getText('code').insert(0, 'shared edit');
  owner.socket.send(JSON.stringify({
    type: 'update',
    update: Buffer.from(Y.encodeStateAsUpdate(owner.document, vector)).toString('base64'),
  }));
  const update = await updateArrived;
  Y.applyUpdate(invitedMember.document, Buffer.from(update.update, 'base64'));
  assert.equal(invitedMember.document.getText('code').toString(), 'shared edit');
  assert.equal(otherRoomClient.document.getText('code').toString(), '');
  assert.equal(await otherRoomUpdate, false);

  await Promise.all([closeClient(owner), closeClient(invitedMember), closeClient(otherRoomClient)]);
  assert.ok(rooms.get(firstRoom.room.id).content_state);
  const reconnected = await connectClient(socketUrl, firstRoom.room.id, 'tokenA');
  clients.push(reconnected);
  assert.equal(reconnected.document.getText('code').toString(), 'shared edit');
});