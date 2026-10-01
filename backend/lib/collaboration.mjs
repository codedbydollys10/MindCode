import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto';
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

const roomIdSchema = z.string().min(3).max(64);
const createRoomSchema = z.object({
  language: z.enum(['python', 'javascript', 'java', 'cpp', 'c', 'go', 'rust']).default('python'),
});
const joinRoomSchema = z.object({ inviteCode: z.string().min(20).max(100) });
const roomRequestDecisionSchema = z.object({ decision: z.enum(['accepted', 'rejected']) });
const teacherInviteSchema = z.object({ inviteCode: z.string().min(20).max(100).optional() });
const teacherInviteAcceptSchema = z.object({ inviteCode: z.string().min(20).max(100) });
const roomFeedbackSchema = z.object({
  message: z.string().trim().min(1).max(2000),
  lineNumber: z.number().int().positive().nullable().optional(),
});
const errorCorrectionSchema = z.object({
  language: z.enum(['python', 'javascript', 'java', 'cpp', 'c', 'go', 'rust']),
  code: z.string().min(1).max(20000),
  error: z.object({
    type: z.enum(['compile', 'runtime', 'unknown']),
    message: z.string().min(1).max(4000),
    line: z.number().int().positive().nullable().optional(),
    column: z.number().int().positive().nullable().optional(),
  }),
  problemContext: z.string().max(2000).optional(),
});
const MAX_UPDATE_BYTES = 1_000_000;
const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const inviteHash = (value) => createHash('sha256').update(value).digest('hex');
const generateRoomCode = () => {
  const suffix = Array.from({ length: 6 }, () => ROOM_CODE_ALPHABET[randomInt(0, ROOM_CODE_ALPHABET.length)]).join('');
  return `MC-${suffix}`;
};
const resolveRoomRecord = async (supabase, identifier) => {
  const candidate = String(identifier ?? '').trim();
  if (!candidate) return null;

  const normalized = candidate.toUpperCase();
  const idLookup = z.string().uuid().safeParse(candidate);
  if (idLookup.success) {
    const { data: roomById, error: idError } = await supabase
      .from('collaboration_rooms')
      .select('id, room_code, created_by, invite_hash, language, content_state, created_at, updated_at')
      .eq('id', candidate)
      .maybeSingle();
    if (idError) throw idError;
    if (roomById) return roomById;
  }

  const { data: roomByCode, error: codeError } = await supabase
    .from('collaboration_rooms')
    .select('id, room_code, created_by, invite_hash, language, content_state, created_at, updated_at')
    .eq('room_code', normalized)
    .maybeSingle();
  if (codeError) throw codeError;
  return roomByCode;
};
const sendJson = (socket, value) => {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(value));
};

const displayName = (user) => {
  const metadataName = user.user_metadata?.name;
  if (typeof metadataName === 'string' && metadataName.trim()) return metadataName.trim().slice(0, 80);
  return String(user.email || 'Participant').split('@')[0].slice(0, 80);
};

const isMissingCollaborationSchemaError = (error) => {
  if (!error) return false;
  const text = [error.message, error.details, error.hint, error.code].filter(Boolean).join(' ');
  return error.code === '42P01' || /could not find the table|does not exist/i.test(text);
};

const collaborationSchemaError = () => ({
  status: 503,
  message: 'The collaboration tables are missing in Supabase. Apply the SQL in frontend/supabase_schema.sql to the live database before creating rooms.',
});

export const createCollaborationRouter = ({ supabase, supabaseAuth = supabase, requestErrorCorrection }) => {
  const router = Router();

  router.use(async (req, res, next) => {
    if (!supabase || !supabaseAuth) return res.status(503).json({ error: 'Collaboration storage is unavailable.' });
    const authorization = req.get('authorization') || '';
    const token = /^Bearer\s+(.+)$/i.exec(authorization)?.[1];
    if (!token) return res.status(401).json({ error: 'Sign in to use collaboration.' });

    try {
      const { data, error } = await supabaseAuth.auth.getUser(token);
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
    const publicRoomId = generateRoomCode();
    const code = '';
    const inviteCode = randomBytes(32).toString('base64url');
    const document = createCollaborationDocument(code, parsed.data.language);
    const room = {
      id,
      room_code: publicRoomId,
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
        room: { id, publicId: publicRoomId, roomCode: publicRoomId, language: room.language },
        inviteCode,
      });
    } catch (error) {
      if (isMissingCollaborationSchemaError(error)) {
        console.error('[collaboration] room creation failed because the collaboration schema is missing from Supabase.', error?.message || error);
        const schemaError = collaborationSchemaError();
        return res.status(schemaError.status).json({ error: schemaError.message });
      }

      console.error('[collaboration] room creation failed:', error?.message || error);
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
      const room = await resolveRoomRecord(supabase, req.params.roomId);
      if (!room) return res.status(404).json({ error: 'This invitation is invalid or expired.' });
      const { data: matchedRoom, error } = await supabase
        .from('collaboration_rooms')
        .select('id, room_code, language, created_by')
        .eq('id', room.id)
        .eq('invite_hash', inviteHash(body.data.inviteCode))
        .maybeSingle();
      if (error) throw error;
      if (!matchedRoom) return res.status(404).json({ error: 'This invitation is invalid or expired.' });

      const { data: existingMember, error: existingMemberError } = await supabase
        .from('collaboration_room_members')
        .select('role')
        .eq('room_id', matchedRoom.id)
        .eq('user_id', req.collaborationUser.id)
        .maybeSingle();
      if (existingMemberError) throw existingMemberError;
      const { error: memberError } = await supabase.from('collaboration_room_members').upsert({
        room_id: matchedRoom.id,
        user_id: req.collaborationUser.id,
        role: existingMember?.role || (req.collaborationUser.id === matchedRoom.created_by ? 'owner' : 'member'),
      }, { onConflict: 'room_id,user_id' });
      if (memberError) throw memberError;
      return res.json({ room: { id: matchedRoom.id, publicId: matchedRoom.room_code || matchedRoom.id, roomCode: matchedRoom.room_code || matchedRoom.id, language: matchedRoom.language } });
    } catch (error) {
      if (isMissingCollaborationSchemaError(error)) {
        console.error('[collaboration] room join failed because the collaboration schema is missing from Supabase.', error?.message || error);
        const schemaError = collaborationSchemaError();
        return res.status(schemaError.status).json({ error: schemaError.message });
      }

      console.error('[collaboration] room join failed:', error?.message || error);
      return res.status(500).json({ error: 'Unable to join this coding room.' });
    }
  });

  router.post('/rooms/:roomId/teacher-invites', async (req, res) => {
    const roomId = roomIdSchema.safeParse(req.params.roomId);
    const body = teacherInviteSchema.safeParse(req.body ?? {});
    if (!roomId.success || !body.success) return res.status(400).json({ error: 'Invalid teacher invitation request.' });

    try {
      const room = await resolveRoomRecord(supabase, req.params.roomId);
      if (!room) return res.status(404).json({ error: 'Coding room not found.' });
      const { data: member, error: memberError } = await supabase
        .from('collaboration_room_members')
        .select('role')
        .eq('room_id', room.id)
        .eq('user_id', req.collaborationUser.id)
        .maybeSingle();
      if (memberError) throw memberError;
      if (member?.role !== 'owner') return res.status(403).json({ error: 'Only the student room owner can invite a teacher.' });

      const now = new Date();
      if (body.data.inviteCode) {
        const { data: existingInvite, error: existingInviteError } = await supabase
          .from('collaboration_room_teacher_invites')
          .select('expires_at')
          .eq('room_id', room.id)
          .eq('token_hash', inviteHash(body.data.inviteCode))
          .is('redeemed_at', null)
          .maybeSingle();
        if (existingInviteError) throw existingInviteError;
        if (existingInvite && new Date(existingInvite.expires_at) > now) {
          return res.json({ inviteCode: body.data.inviteCode, expiresAt: existingInvite.expires_at });
        }
      }

      const { error: invalidateError } = await supabase
        .from('collaboration_room_teacher_invites')
        .update({ redeemed_at: now.toISOString() })
        .eq('room_id', room.id)
        .is('redeemed_at', null);
      if (invalidateError) throw invalidateError;

      const inviteCode = randomBytes(32).toString('base64url');
      const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
      const { error: insertError } = await supabase.from('collaboration_room_teacher_invites').insert({
        room_id: room.id,
        token_hash: inviteHash(inviteCode),
        invited_by: req.collaborationUser.id,
        expires_at: expiresAt,
      });
      if (insertError) throw insertError;
      return res.status(201).json({ inviteCode, expiresAt });
    } catch (error) {
      if (isMissingCollaborationSchemaError(error)) {
        const schemaError = collaborationSchemaError();
        return res.status(schemaError.status).json({ error: schemaError.message });
      }
      console.error('[collaboration] teacher invite creation failed:', error?.message || error);
      return res.status(500).json({ error: 'Unable to create a teacher invitation.' });
    }
  });

  router.post('/rooms/:roomId/teacher-invites/accept', async (req, res) => {
    const roomId = roomIdSchema.safeParse(req.params.roomId);
    const body = teacherInviteAcceptSchema.safeParse(req.body);
    if (!roomId.success || !body.success) return res.status(400).json({ error: 'Invalid teacher invitation.' });

    try {
      const room = await resolveRoomRecord(supabase, req.params.roomId);
      if (!room) return res.status(404).json({ error: 'Coding room not found.' });
      if (req.collaborationUser.id === room.created_by) {
        return res.status(409).json({ error: 'The room owner cannot join as the invited teacher.' });
      }

      const { data: invite, error: inviteError } = await supabase
        .from('collaboration_room_teacher_invites')
        .select('id, expires_at')
        .eq('room_id', room.id)
        .eq('token_hash', inviteHash(body.data.inviteCode))
        .is('redeemed_at', null)
        .maybeSingle();
      if (inviteError) throw inviteError;
      if (!invite || new Date(invite.expires_at) <= new Date()) {
        return res.status(404).json({ error: 'This teacher invitation is invalid or expired.' });
      }

      const { data: redeemedInvite, error: redeemError } = await supabase
        .from('collaboration_room_teacher_invites')
        .update({ redeemed_at: new Date().toISOString(), redeemed_by: req.collaborationUser.id })
        .eq('id', invite.id)
        .is('redeemed_at', null)
        .select('id')
        .maybeSingle();
      if (redeemError) throw redeemError;
      if (!redeemedInvite) return res.status(409).json({ error: 'This teacher invitation has already been used.' });

      const { error: memberError } = await supabase.from('collaboration_room_members').upsert({
        room_id: room.id,
        user_id: req.collaborationUser.id,
        role: 'teacher',
      }, { onConflict: 'room_id,user_id' });
      if (memberError) {
        await supabase.from('collaboration_room_teacher_invites').update({
          redeemed_at: null,
          redeemed_by: null,
        }).eq('id', invite.id);
        throw memberError;
      }

      return res.json({ room: {
        id: room.id,
        publicId: room.room_code || room.id,
        roomCode: room.room_code || room.id,
        language: room.language,
        role: 'teacher',
      } });
    } catch (error) {
      if (isMissingCollaborationSchemaError(error)) {
        const schemaError = collaborationSchemaError();
        return res.status(schemaError.status).json({ error: schemaError.message });
      }
      console.error('[collaboration] teacher invite acceptance failed:', error?.message || error);
      return res.status(500).json({ error: 'Unable to join as a teacher.' });
    }
  });

  router.post('/rooms/:roomId/requests', async (req, res) => {
    const roomId = roomIdSchema.safeParse(req.params.roomId);
    if (!roomId.success) return res.status(400).json({ error: 'Invalid room identifier.' });

    try {
      const room = await resolveRoomRecord(supabase, req.params.roomId);
      if (!room) return res.status(404).json({ error: 'Coding room not found.' });

      const { data: member, error: memberError } = await supabase
        .from('collaboration_room_members')
        .select('role')
        .eq('room_id', room.id)
        .eq('user_id', req.collaborationUser.id)
        .maybeSingle();
      if (memberError) throw memberError;
      if (member) return res.json({ status: 'member' });

      const { data: existingRequest, error: existingRequestError } = await supabase
        .from('collaboration_room_join_requests')
        .select('status')
        .eq('room_id', room.id)
        .eq('user_id', req.collaborationUser.id)
        .maybeSingle();
      if (existingRequestError) throw existingRequestError;
      if (existingRequest?.status === 'pending' || existingRequest?.status === 'accepted') {
        return res.status(202).json({ status: existingRequest.status });
      }

      const { error } = await supabase.from('collaboration_room_join_requests').upsert({
        id: randomUUID(),
        room_id: room.id,
        user_id: req.collaborationUser.id,
        requester_name: displayName(req.collaborationUser),
        status: 'pending',
        requested_at: new Date().toISOString(),
        decided_by: null,
        decided_at: null,
      }, { onConflict: 'room_id,user_id' });
      if (error) throw error;
      return res.status(202).json({ status: 'pending' });
    } catch (error) {
      if (isMissingCollaborationSchemaError(error)) {
        const schemaError = collaborationSchemaError();
        return res.status(schemaError.status).json({ error: schemaError.message });
      }
      console.error('[collaboration] access request failed:', error?.message || error);
      return res.status(500).json({ error: 'Unable to request access to this coding room.' });
    }
  });

  router.get('/rooms/:roomId/request', async (req, res) => {
    const roomId = roomIdSchema.safeParse(req.params.roomId);
    if (!roomId.success) return res.status(400).json({ error: 'Invalid room identifier.' });

    try {
      const room = await resolveRoomRecord(supabase, req.params.roomId);
      if (!room) return res.status(404).json({ error: 'Coding room not found.' });
      const { data: request, error } = await supabase
        .from('collaboration_room_join_requests')
        .select('status')
        .eq('room_id', room.id)
        .eq('user_id', req.collaborationUser.id)
        .maybeSingle();
      if (error) throw error;
      if (!request) return res.status(404).json({ error: 'No access request exists for this user.' });
      return res.json({ status: request.status });
    } catch (error) {
      if (isMissingCollaborationSchemaError(error)) {
        const schemaError = collaborationSchemaError();
        return res.status(schemaError.status).json({ error: schemaError.message });
      }
      console.error('[collaboration] access request status failed:', error?.message || error);
      return res.status(500).json({ error: 'Unable to check the room access request.' });
    }
  });

  router.get('/rooms/:roomId/requests', async (req, res) => {
    const roomId = roomIdSchema.safeParse(req.params.roomId);
    if (!roomId.success) return res.status(400).json({ error: 'Invalid room identifier.' });

    try {
      const room = await resolveRoomRecord(supabase, req.params.roomId);
      if (!room) return res.status(404).json({ error: 'Coding room not found.' });
      const { data: owner, error: ownerError } = await supabase
        .from('collaboration_room_members')
        .select('role')
        .eq('room_id', room.id)
        .eq('user_id', req.collaborationUser.id)
        .maybeSingle();
      if (ownerError) throw ownerError;
      if (owner?.role !== 'owner') return res.status(403).json({ error: 'Only the room owner can review access requests.' });

      const { data: requests, error } = await supabase
        .from('collaboration_room_join_requests')
        .select('id, user_id, requester_name, requested_at')
        .eq('room_id', room.id)
        .eq('status', 'pending');
      if (error) throw error;
      return res.json({ requests: requests || [] });
    } catch (error) {
      if (isMissingCollaborationSchemaError(error)) {
        const schemaError = collaborationSchemaError();
        return res.status(schemaError.status).json({ error: schemaError.message });
      }
      console.error('[collaboration] pending access requests failed:', error?.message || error);
      return res.status(500).json({ error: 'Unable to load room access requests.' });
    }
  });

  router.patch('/rooms/:roomId/requests/:requestId', async (req, res) => {
    const roomId = roomIdSchema.safeParse(req.params.roomId);
    const requestId = z.string().uuid().safeParse(req.params.requestId);
    const body = roomRequestDecisionSchema.safeParse(req.body);
    if (!roomId.success || !requestId.success || !body.success) {
      return res.status(400).json({ error: 'Invalid room access decision.' });
    }

    try {
      const room = await resolveRoomRecord(supabase, req.params.roomId);
      if (!room) return res.status(404).json({ error: 'Coding room not found.' });
      const { data: owner, error: ownerError } = await supabase
        .from('collaboration_room_members')
        .select('role')
        .eq('room_id', room.id)
        .eq('user_id', req.collaborationUser.id)
        .maybeSingle();
      if (ownerError) throw ownerError;
      if (owner?.role !== 'owner') return res.status(403).json({ error: 'Only the room owner can review access requests.' });

      const { data: request, error: requestError } = await supabase
        .from('collaboration_room_join_requests')
        .select('id, user_id, status')
        .eq('id', req.params.requestId)
        .eq('room_id', room.id)
        .maybeSingle();
      if (requestError) throw requestError;
      if (!request || request.status !== 'pending') return res.status(404).json({ error: 'This access request is no longer pending.' });

      const decidedAt = new Date().toISOString();
      const { data: updatedRequest, error: updateError } = await supabase
        .from('collaboration_room_join_requests')
        .update({ status: body.data.decision, decided_by: req.collaborationUser.id, decided_at: decidedAt })
        .eq('id', request.id)
        .eq('status', 'pending')
        .select('id, status')
        .maybeSingle();
      if (updateError) throw updateError;
      if (!updatedRequest) return res.status(409).json({ error: 'This access request has already been reviewed.' });

      if (body.data.decision === 'accepted') {
        const { error: memberError } = await supabase.from('collaboration_room_members').upsert({
          room_id: room.id,
          user_id: request.user_id,
          role: 'member',
        }, { onConflict: 'room_id,user_id' });
        if (memberError) {
          await supabase.from('collaboration_room_join_requests').update({
            status: 'pending',
            decided_by: null,
            decided_at: null,
          }).eq('id', request.id);
          throw memberError;
        }
      }

      return res.json({ request: updatedRequest });
    } catch (error) {
      if (isMissingCollaborationSchemaError(error)) {
        const schemaError = collaborationSchemaError();
        return res.status(schemaError.status).json({ error: schemaError.message });
      }
      console.error('[collaboration] access request decision failed:', error?.message || error);
      return res.status(500).json({ error: 'Unable to review this room access request.' });
    }
  });

  router.get('/rooms/:roomId/feedback', async (req, res) => {
    const roomId = roomIdSchema.safeParse(req.params.roomId);
    if (!roomId.success) return res.status(400).json({ error: 'Invalid room identifier.' });

    try {
      const room = await resolveRoomRecord(supabase, req.params.roomId);
      if (!room) return res.status(404).json({ error: 'Coding room not found.' });
      const { data: member, error: memberError } = await supabase
        .from('collaboration_room_members')
        .select('role')
        .eq('room_id', room.id)
        .eq('user_id', req.collaborationUser.id)
        .maybeSingle();
      if (memberError) throw memberError;
      if (!member) return res.status(403).json({ error: 'Room membership is required to view feedback.' });

      const { data: feedback, error } = await supabase
        .from('collaboration_room_feedback')
        .select('id, author_id, message, line_number, created_at')
        .eq('room_id', room.id);
      if (error) throw error;
      return res.json({ feedback: feedback || [] });
    } catch (error) {
      if (isMissingCollaborationSchemaError(error)) {
        const schemaError = collaborationSchemaError();
        return res.status(schemaError.status).json({ error: schemaError.message });
      }
      console.error('[collaboration] feedback load failed:', error?.message || error);
      return res.status(500).json({ error: 'Unable to load room feedback.' });
    }
  });

  router.post('/rooms/:roomId/feedback', async (req, res) => {
    const roomId = roomIdSchema.safeParse(req.params.roomId);
    const body = roomFeedbackSchema.safeParse(req.body);
    if (!roomId.success || !body.success) return res.status(400).json({ error: 'Enter valid room feedback.' });

    try {
      const room = await resolveRoomRecord(supabase, req.params.roomId);
      if (!room) return res.status(404).json({ error: 'Coding room not found.' });
      const { data: member, error: memberError } = await supabase
        .from('collaboration_room_members')
        .select('role')
        .eq('room_id', room.id)
        .eq('user_id', req.collaborationUser.id)
        .maybeSingle();
      if (memberError) throw memberError;
      if (member?.role !== 'teacher') return res.status(403).json({ error: 'Only the invited teacher can add room feedback.' });

      const { data: feedback, error } = await supabase.from('collaboration_room_feedback').insert({
        room_id: room.id,
        author_id: req.collaborationUser.id,
        message: body.data.message,
        line_number: body.data.lineNumber ?? null,
      }).select('id, author_id, message, line_number, created_at').maybeSingle();
      if (error) throw error;
      return res.status(201).json({ feedback });
    } catch (error) {
      if (isMissingCollaborationSchemaError(error)) {
        const schemaError = collaborationSchemaError();
        return res.status(schemaError.status).json({ error: schemaError.message });
      }
      console.error('[collaboration] feedback submission failed:', error?.message || error);
      return res.status(500).json({ error: 'Unable to add room feedback.' });
    }
  });

  router.post('/rooms/:roomId/error-correction', async (req, res) => {
    const roomId = roomIdSchema.safeParse(req.params.roomId);
    const body = errorCorrectionSchema.safeParse(req.body);
    if (!roomId.success || !body.success) return res.status(400).json({ error: 'Provide valid code and error details.' });

    try {
      const room = await resolveRoomRecord(supabase, req.params.roomId);
      if (!room) return res.status(404).json({ error: 'Coding room not found.' });
      const { data: member, error: memberError } = await supabase
        .from('collaboration_room_members')
        .select('role')
        .eq('room_id', room.id)
        .eq('user_id', req.collaborationUser.id)
        .maybeSingle();
      if (memberError) throw memberError;
      if (!member) return res.status(403).json({ error: 'Room membership is required for AI error correction.' });
      if (!requestErrorCorrection) return res.status(503).json({ error: 'AI correction is temporarily unavailable.' });

      return res.json(await requestErrorCorrection(body.data));
    } catch (error) {
      console.error('[collaboration] AI error correction failed:', error?.message || error);
      return res.status(503).json({ error: 'AI correction is temporarily unavailable.' });
    }
  });

  router.get('/rooms/:roomId', async (req, res) => {
    const roomId = roomIdSchema.safeParse(req.params.roomId);
    if (!roomId.success) return res.status(400).json({ error: 'Invalid room identifier.' });

    try {
      const room = await resolveRoomRecord(supabase, req.params.roomId);
      if (!room) return res.status(404).json({ error: 'Coding room not found.' });

      const { data: member, error: memberError } = await supabase
        .from('collaboration_room_members')
        .select('role')
        .eq('room_id', room.id)
        .eq('user_id', req.collaborationUser.id)
        .maybeSingle();
      if (memberError) throw memberError;
      if (!member) return res.status(403).json({ error: 'You are not a member of this coding room.' });

      return res.json({ room: { ...room, publicId: room.room_code || room.id, roomCode: room.room_code || room.id, role: member.role } });
    } catch (error) {
      if (isMissingCollaborationSchemaError(error)) {
        console.error('[collaboration] room lookup failed because the collaboration schema is missing from Supabase.', error?.message || error);
        const schemaError = collaborationSchemaError();
        return res.status(schemaError.status).json({ error: schemaError.message });
      }

      console.error('[collaboration] room lookup failed:', error?.message || error);
      return res.status(500).json({ error: 'Unable to load this coding room.' });
    }
  });

  return router;
};

export const attachCollaborationWebSocket = ({ server, supabase, supabaseAuth = supabase, isAllowedOrigin }) => {
  if (!supabase || !supabaseAuth) {
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
    const resolvedRoom = await resolveRoomRecord(supabase, roomId);
    if (!resolvedRoom) return null;
    const roomKey = resolvedRoom.id;
    const existing = rooms.get(roomKey);
    if (existing) return existing;
    const pendingLoad = loadingRooms.get(roomKey);
    if (pendingLoad) return pendingLoad;

    const load = (async () => {
      const { data: room, error } = await supabase
        .from('collaboration_rooms')
        .select('id, room_code, language, content_state')
        .eq('id', roomKey)
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
      rooms.set(roomKey, roomState);
      return roomState;
    })();
    loadingRooms.set(roomKey, load);
    try {
      return await load;
    } finally {
      loadingRooms.delete(roomKey);
    }
  };

  const broadcastParticipants = (roomState) => {
    for (const recipient of roomState.clients) {
      const participants = [...roomState.clients].map((client) => ({
        id: client.participantId,
        name: client.participantName,
        role: client.role,
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

    const { data: authData, error: authError } = await supabaseAuth.auth.getUser(payload.accessToken);
    if (authError || !authData.user) {
      socket.close(4401, 'Sign in required');
      return;
    }
    const user = authData.user;
    const resolvedRoom = await resolveRoomRecord(supabase, payload.roomId);
    if (!resolvedRoom) {
      socket.close(4404, 'Room not found');
      return;
    }
    const { data: member, error: memberError } = await supabase
      .from('collaboration_room_members')
      .select('role')
      .eq('room_id', resolvedRoom.id)
      .eq('user_id', user.id)
      .maybeSingle();
    if (memberError || !member) {
      socket.close(4403, 'Room membership required');
      return;
    }

    const roomState = await getRoomState(resolvedRoom.id);
    if (!roomState) {
      socket.close(4404, 'Room not found');
      return;
    }
    socket.roomId = resolvedRoom.id;
    socket.roomState = roomState;
    socket.userId = user.id;
    socket.role = member.role === 'teacher' ? 'teacher' : member.role === 'owner' ? 'owner' : 'member';
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
        if (socket.role === 'teacher') return;
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