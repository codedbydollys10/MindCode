import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Router } from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import * as Y from 'yjs';
import { z } from 'zod';
import {
  applyCollaborationUpdate,
  createCollaborationDocument,
  encodeCollaborationState,
  encodeCollaborationUpdate,
  restoreCollaborationDocument,
} from './collaborationDocument.mjs';

const roomIdSchema = z.string().uuid();
const createRoomSchema = z.object({
  language: z.enum(['python', 'javascript', 'java', 'cpp', 'c', 'go', 'rust']).default('python'),
});
const joinRoomSchema = z.object({ inviteCode: z.string().min(20).max(100) });
const MAX_UPDATE_BYTES = 1_000_000;

const inviteHash = (value) => createHash('sha256').update(value).digest('hex');
const sendJson = (socket, value) => {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(value));
};

const displayName = (user) => {
  const metadataName = user.user_metadata?.name;
  if (typeof metadataName === 'string' && metadataName.trim()) return metadataName.trim().slice(0, 80);
  return String(user.email || 'Participant').split('@')[0].slice(0, 80);
};

export const createCollaborationRouter = ({ supabase }) => {
  const router = Router();

  router.use(async (req, res, next) => {
    if (!supabase) return res.status(503).json({ error: 'Collaboration storage is unavailable.' });
    const authorization = req.get('authorization') || '';
    const token = /^Bearer\s+(.+)$/i.exec(authorization)?.[1];
    if (!token) return res.status(401).json({ error: 'Sign in to use collaboration.' });

    try {
      const { data, error } = await supabase.auth.getUser(token);
      if (error || !data.user) return res.status(401).json({ error: 'Your session is invalid or expired.' });
      req.collaborationUser = data.user;
      next();
    } catch {
      res.status(401).json({ error: 'Unable to verify your session.' });
    }
  });

  router.post('/rooms', async (req, res) => {
    const parsed = createRoomSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Choose a supported programming language.' });

    const id = randomUUID();
    const code = '';
    const inviteCode = randomBytes(32).toString('base64url');
    const document = createCollaborationDocument(code, parsed.data.language);
    const room = {
      id,
      created_by: req.collaborationUser.id,
      invite_hash: inviteHash(inviteCode),
      language: parsed.data.language,
      content_state: encodeCollaborationState(document),
    };

    try {
      const { error: roomError } = await supabase.from('collaboration_rooms').insert(room);
      if (roomError) throw roomError;
      const { error: memberError } = await supabase.from('collaboration_room_members').insert({
        room_id: id,
        user_id: req.collaborationUser.id,
        role: 'owner',
      });
      if (memberError) {
        await supabase.from('collaboration_rooms').delete().eq('id', id);
        throw memberError;
      }
      return res.status(201).json({
        room: { id, language: room.language },
        inviteCode,
      });
    } catch (error) {
      console.error('[collaboration] room creation failed:', error.message);
      return res.status(500).json({ error: 'Unable to create a coding room.' });
    } finally {
      document.destroy();
    }
  });

  router.post('/rooms/:roomId/join', async (req, res) => {
    const roomId = roomIdSchema.safeParse(req.params.roomId);
    const body = joinRoomSchema.safeParse(req.body);
    if (!roomId.success || !body.success) return res.status(400).json({ error: 'Invalid room invitation.' });

    try {
      const { data: room, error } = await supabase
        .from('collaboration_rooms')
        .select('id, language, created_by')
        .eq('id', roomId.data)
        .eq('invite_hash', inviteHash(body.data.inviteCode))
        .maybeSingle();
      if (error) throw error;
      if (!room) return res.status(404).json({ error: 'This invitation is invalid or expired.' });

      const { error: memberError } = await supabase.from('collaboration_room_members').upsert({
        room_id: room.id,
        user_id: req.collaborationUser.id,
        role: req.collaborationUser.id === room.created_by ? 'owner' : 'member',
      }, { onConflict: 'room_id,user_id' });
      if (memberError) throw memberError;
      return res.json({ room: { id: room.id, language: room.language } });
    } catch (error) {
      console.error('[collaboration] room join failed:', error.message);
      return res.status(500).json({ error: 'Unable to join this coding room.' });
    }
  });

  router.get('/rooms/:roomId', async (req, res) => {
    const roomId = roomIdSchema.safeParse(req.params.roomId);
    if (!roomId.success) return res.status(400).json({ error: 'Invalid room identifier.' });

    try {
      const { data: member, error: memberError } = await supabase
        .from('collaboration_room_members')
        .select('role')
        .eq('room_id', roomId.data)
        .eq('user_id', req.collaborationUser.id)
        .maybeSingle();
      if (memberError) throw memberError;
      if (!member) return res.status(403).json({ error: 'You are not a member of this coding room.' });

      const { data: room, error } = await supabase
        .from('collaboration_rooms')
        .select('id, language, created_at, updated_at')
        .eq('id', roomId.data)
        .maybeSingle();
      if (error) throw error;
      if (!room) return res.status(404).json({ error: 'Coding room not found.' });
      return res.json({ room: { ...room, role: member.role } });
    } catch (error) {
      console.error('[collaboration] room lookup failed:', error.message);
      return res.status(500).json({ error: 'Unable to load this coding room.' });
    }
  });

  return router;
};

export const attachCollaborationWebSocket = ({ server, supabase, isAllowedOrigin }) => {
  if (!supabase) {
    console.warn('[collaboration] Supabase is required; collaboration WebSocket is disabled.');
    return null;
  }

  const webSocketServer = new WebSocketServer({ noServer: true, maxPayload: 1_500_000 });
  const rooms = new Map();
  const loadingRooms = new Map();

  const persistRoom = async (roomId, roomState) => {
    try {
      const contentState = encodeCollaborationState(roomState.document);
      if (Buffer.from(contentState, 'base64').byteLength > MAX_UPDATE_BYTES) {
        console.warn('[collaboration] room state exceeds persistence size limit:', roomId);
        return;
      }
      const { error } = await supabase.from('collaboration_rooms').update({
        content_state: contentState,
        updated_at: new Date().toISOString(),
      }).eq('id', roomId);
      if (error) {
        console.error('[collaboration] state persistence failed:', error.message);
        return false;
      }
      return true;
    } catch (error) {
      console.error('[collaboration] state persistence failed:', error.message);
      return false;
    }
  };

  const getRoomState = async (roomId) => {
    const existing = rooms.get(roomId);
    if (existing) return existing;
    const pendingLoad = loadingRooms.get(roomId);
    if (pendingLoad) return pendingLoad;

    const load = (async () => {
      const { data: room, error } = await supabase
        .from('collaboration_rooms')
        .select('id, language, content_state')
        .eq('id', roomId)
        .maybeSingle();
      if (error) throw error;
      if (!room) return null;

      const document = restoreCollaborationDocument(room.content_state);
      const roomState = { document, language: room.language, clients: new Set(), saveTimer: null };
      document.on('update', (update, origin) => {
        const encodedUpdate = encodeCollaborationUpdate(update);
        for (const client of roomState.clients) {
          if (client !== origin) sendJson(client, { type: 'update', update: encodedUpdate });
        }
        if (roomState.saveTimer) clearTimeout(roomState.saveTimer);
        roomState.saveTimer = setTimeout(() => {
          roomState.saveTimer = null;
          void persistRoom(roomId, roomState);
        }, 750);
      });
      rooms.set(roomId, roomState);
      return roomState;
    })();
    loadingRooms.set(roomId, load);
    try {
      return await load;
    } finally {
      loadingRooms.delete(roomId);
    }
  };

  const broadcastParticipants = (roomState) => {
    for (const recipient of roomState.clients) {
      const participants = [...roomState.clients].map((client) => ({
        id: client.participantId,
        name: client.participantName,
        isSelf: client.userId === recipient.userId,
      }));
      sendJson(recipient, { type: 'participants', participants });
    }
  };

  const handleAuthentication = async (socket, payload) => {
    const roomId = roomIdSchema.safeParse(payload.roomId);
    if (!roomId.success || typeof payload.accessToken !== 'string' || payload.accessToken.length > 8192) {
      socket.close(4401, 'Invalid session credentials');
      return;
    }

    const { data: authData, error: authError } = await supabase.auth.getUser(payload.accessToken);
    if (authError || !authData.user) {
      socket.close(4401, 'Sign in required');
      return;
    }
    const user = authData.user;
    const { data: member, error: memberError } = await supabase
      .from('collaboration_room_members')
      .select('role')
      .eq('room_id', roomId.data)
      .eq('user_id', user.id)
      .maybeSingle();
    if (memberError || !member) {
      socket.close(4403, 'Room membership required');
      return;
    }

    const roomState = await getRoomState(roomId.data);
    if (!roomState) {
      socket.close(4404, 'Room not found');
      return;
    }
    socket.roomId = roomId.data;
    socket.roomState = roomState;
    socket.userId = user.id;
    socket.participantId = randomUUID();
    socket.participantName = displayName(user);
    roomState.clients.add(socket);
    sendJson(socket, {
      type: 'sync',
      update: encodeCollaborationUpdate(Y.encodeStateAsUpdate(roomState.document)),
      language: roomState.language,
    });
    broadcastParticipants(roomState);
  };

  server.on('upgrade', (request, socket, head) => {
    const requestUrl = new URL(request.url || '/', 'http://localhost');
    if (requestUrl.pathname !== '/collaboration') return;
    const origin = request.headers.origin || '';
    if (!isAllowedOrigin(origin)) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }
    webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
      webSocketServer.emit('connection', webSocket, request);
    });
  });

  webSocketServer.on('connection', (socket) => {
    let authenticated = false;
    const authenticationTimeout = setTimeout(() => {
      if (!authenticated) socket.close(4401, 'Authentication timeout');
    }, 10_000);

    socket.on('message', async (message) => {
      try {
        const payload = JSON.parse(message.toString());
        if (!authenticated) {
          if (payload.type !== 'authenticate') return socket.close(4401, 'Authentication required');
          if (socket.authenticating) return;
          socket.authenticating = true;
          await handleAuthentication(socket, payload);
          authenticated = Boolean(socket.roomState);
          if (authenticated) clearTimeout(authenticationTimeout);
          return;
        }
        if (payload.type !== 'update' || typeof payload.update !== 'string') return;
        applyCollaborationUpdate(socket.roomState.document, payload.update, socket);
      } catch (error) {
        console.warn('[collaboration] rejected WebSocket message:', error.message);
        socket.close(1008, 'Invalid collaboration message');
      }
    });

    socket.on('close', () => {
      clearTimeout(authenticationTimeout);
      const roomState = socket.roomState;
      if (!roomState) return;
      roomState.clients.delete(socket);
      broadcastParticipants(roomState);
      if (!roomState.clients.size) {
        if (roomState.saveTimer) clearTimeout(roomState.saveTimer);
        roomState.saveTimer = null;
        void persistRoom(socket.roomId, roomState).then((persisted) => {
          if (!persisted || roomState.clients.size || rooms.get(socket.roomId) !== roomState) return;
          rooms.delete(socket.roomId);
          roomState.document.destroy();
        });
      }
    });
  });

  return webSocketServer;
};