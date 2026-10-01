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
const createAssignmentSchema = z.object({
  roomName: z.string().trim().min(1).max(120),
  title: z.string().trim().min(1).max(120),
  instructions: z.string().max(10000).default(''),
  deadline: z.string().datetime().nullable().optional(),
  language: z.enum(['python', 'javascript', 'java', 'cpp', 'c', 'go', 'rust']).default('python'),
});
const assignmentRoomCodeSchema = z.object({ roomCode: z.string().trim().min(3).max(64) });
const assignmentCodeSchema = z.object({ code: z.string().max(20000) });
const assignmentFeedbackRequestSchema = z.object({ message: z.string().trim().max(2000).default('') });
const assignmentRunSchema = z.object({ hasError: z.boolean() });
const assignmentFeedbackSchema = z.object({ message: z.string().trim().min(1).max(2000), concept: z.string().trim().max(120).optional() });
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
      .select('id, room_code, created_by, teacher_id, invite_hash, language, room_type, content_state, created_at, updated_at')
      .eq('id', candidate)
      .maybeSingle();
    if (idError) throw idError;
    if (roomById) return roomById;
  }

  const { data: roomByCode, error: codeError } = await supabase
    .from('collaboration_rooms')
    .select('id, room_code, created_by, teacher_id, invite_hash, language, room_type, content_state, created_at, updated_at')
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

const userRole = (user) => user.app_metadata?.role === 'teacher' ? 'teacher' : 'student';

const getAssignment = async (supabase, roomId) => {
  const { data, error } = await supabase.from('collaboration_assignments')
    .select('room_id, room_name, title, teacher_name, instructions, deadline, created_at')
    .eq('room_id', roomId)
    .maybeSingle();
  if (error) throw error;
  return data;
};

const isMissingCollaborationSchemaError = (error) => {
  if (!error) return false;
  const text = [error.message, error.details, error.hint, error.code].filter(Boolean).join(' ');
  return error.code === '42P01'
    || error.code === '42703'
    || error.code === 'PGRST204'
    || error.code === 'PGRST205'
    || /could not find the (?:table|column)|does not exist/i.test(text);
};

const collaborationSchemaError = () => ({
  status: 503,
  message: 'The collaboration database schema is incomplete. Apply frontend/migrations/20261001_teacher_assignments.sql in the Supabase SQL editor, then retry.',
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

  router.post('/assignments', async (req, res) => {
    if (userRole(req.collaborationUser) !== 'teacher') {
      return res.status(403).json({ error: 'Only teacher accounts can create assignments.' });
    }
    const parsed = createAssignmentSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Enter a room name, assignment title, instructions, deadline, and supported language.' });

    const roomId = randomUUID();
    const roomCode = generateRoomCode();
    const inviteCode = randomBytes(32).toString('base64url');
    const document = createCollaborationDocument('', parsed.data.language);
    try {
      const { error: roomError } = await supabase.from('collaboration_rooms').insert({
        id: roomId,
        room_code: roomCode,
        created_by: req.collaborationUser.id,
        teacher_id: req.collaborationUser.id,
        invite_hash: inviteHash(inviteCode),
        language: parsed.data.language,
        room_type: 'teacher_assignment',
        content_state: encodeCollaborationState(document),
      });
      if (roomError) throw roomError;
      const { error: assignmentError } = await supabase.from('collaboration_assignments').insert({
        room_id: roomId,
        room_name: parsed.data.roomName,
        title: parsed.data.title,
        teacher_name: displayName(req.collaborationUser),
        instructions: parsed.data.instructions,
        deadline: parsed.data.deadline || null,
      });
      if (assignmentError) throw assignmentError;
      const { error: memberError } = await supabase.from('collaboration_room_members').insert({
        room_id: roomId,
        user_id: req.collaborationUser.id,
        role: 'owner',
      });
      if (memberError) throw memberError;
      return res.status(201).json({
        room: { id: roomId, publicId: roomCode, roomCode, language: parsed.data.language, roomType: 'teacher_assignment', teacherId: req.collaborationUser.id },
      });
    } catch (error) {
      await supabase.from('collaboration_rooms').delete().eq('id', roomId);
      if (isMissingCollaborationSchemaError(error)) {
        const schemaError = collaborationSchemaError();
        return res.status(schemaError.status).json({ error: schemaError.message });
      }
      console.error('[collaboration] assignment creation failed:', error?.message || error);
      return res.status(500).json({ error: 'Unable to create this teacher assignment.' });
    } finally {
      document.destroy();
    }
  });

  router.post('/assignments/lookup', async (req, res) => {
    if (userRole(req.collaborationUser) !== 'student') {
      return res.status(403).json({ error: 'Only student accounts can join teacher assignments.' });
    }
    const parsed = assignmentRoomCodeSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Enter a valid assignment room code.' });
    try {
      const room = await resolveRoomRecord(supabase, parsed.data.roomCode);
      if (!room || room.room_type !== 'teacher_assignment' || !room.teacher_id) {
        return res.status(404).json({ error: 'No teacher assignment was found for this room code.' });
      }
      const assignment = await getAssignment(supabase, room.id);
      if (!assignment) return res.status(404).json({ error: 'This assignment is no longer available.' });
      return res.json({ room: { id: room.id, publicId: room.room_code, roomCode: room.room_code, language: room.language }, assignment });
    } catch (error) {
      if (isMissingCollaborationSchemaError(error)) {
        const schemaError = collaborationSchemaError();
        return res.status(schemaError.status).json({ error: schemaError.message });
      }
      console.error('[collaboration] assignment lookup failed:', error?.message || error);
      return res.status(500).json({ error: 'Unable to look up this assignment.' });
    }
  });

  router.post('/assignments/:roomId/join', async (req, res) => {
    if (userRole(req.collaborationUser) !== 'student') {
      return res.status(403).json({ error: 'Only student accounts can join teacher assignments.' });
    }
    const roomId = roomIdSchema.safeParse(req.params.roomId);
    if (!roomId.success) return res.status(400).json({ error: 'Invalid assignment room.' });
    try {
      const room = await resolveRoomRecord(supabase, req.params.roomId);
      if (!room || room.room_type !== 'teacher_assignment' || !room.teacher_id) return res.status(404).json({ error: 'Teacher assignment not found.' });
      const { data: existing, error: existingError } = await supabase.from('collaboration_room_members')
        .select('role').eq('room_id', room.id).eq('user_id', req.collaborationUser.id).maybeSingle();
      if (existingError) throw existingError;
      if (existing?.role === 'owner' || existing?.role === 'teacher') {
        return res.status(403).json({ error: 'Assignment teachers cannot join as students.' });
      }
      const { error: memberError } = await supabase.from('collaboration_room_members').upsert({
        room_id: room.id,
        user_id: req.collaborationUser.id,
        role: 'member',
      }, { onConflict: 'room_id,user_id' });
      if (memberError) throw memberError;
      const assignment = await getAssignment(supabase, room.id);
      return res.json({ room: { id: room.id, publicId: room.room_code, roomCode: room.room_code, language: room.language, roomType: room.room_type, teacherId: room.teacher_id, role: 'member', assignment } });
    } catch (error) {
      if (isMissingCollaborationSchemaError(error)) {
        const schemaError = collaborationSchemaError();
        return res.status(schemaError.status).json({ error: schemaError.message });
      }
      console.error('[collaboration] assignment join failed:', error?.message || error);
      return res.status(500).json({ error: 'Unable to join this assignment.' });
    }
  });

  const getAssignmentMember = async (roomIdentifier, user) => {
    const room = await resolveRoomRecord(supabase, roomIdentifier);
    if (!room || room.room_type !== 'teacher_assignment' || !room.teacher_id) {
      return { room: null, member: null, isStudent: false, isTeacherOwner: false };
    }
    const { data: member, error } = await supabase.from('collaboration_room_members')
      .select('role').eq('room_id', room.id).eq('user_id', user.id).maybeSingle();
    if (error) throw error;
    return {
      room,
      member,
      isStudent: userRole(user) === 'student' && member?.role === 'member',
      isTeacherOwner: userRole(user) === 'teacher' && room.teacher_id === user.id && member?.role === 'owner',
    };
  };

  const readProgress = async (roomId, userId) => {
    const { data, error } = await supabase.from('collaboration_assignment_progress')
      .select('room_id, user_id, code_runs, attempts, errors, submission_status, submitted_at, updated_at')
      .eq('room_id', roomId).eq('user_id', userId).maybeSingle();
    if (error) throw error;
    return data || {
      room_id: roomId,
      user_id: userId,
      code_runs: 0,
      attempts: 0,
      errors: 0,
      submission_status: 'Pending',
      submitted_at: null,
    };
  };

  router.get('/assignments', async (req, res) => {
    if (userRole(req.collaborationUser) !== 'teacher') {
      return res.status(403).json({ error: 'Only teacher accounts can view assignment rooms.' });
    }
    try {
      const { data: rooms, error } = await supabase.from('collaboration_rooms')
        .select('id, room_code, language, created_at')
        .eq('teacher_id', req.collaborationUser.id)
        .eq('room_type', 'teacher_assignment');
      if (error) throw error;
      const assignments = await Promise.all((rooms || []).map(async (room) => ({
        id: room.id,
        roomCode: room.room_code,
        language: room.language,
        createdAt: room.created_at,
        assignment: await getAssignment(supabase, room.id),
      })));
      return res.json({ assignments });
    } catch (error) {
      if (isMissingCollaborationSchemaError(error)) {
        const schemaError = collaborationSchemaError();
        return res.status(schemaError.status).json({ error: schemaError.message });
      }
      console.error('[collaboration] teacher assignment list failed:', error?.message || error);
      return res.status(500).json({ error: 'Unable to load your assignment rooms.' });
    }
  });

  router.get('/assignments/:roomId', async (req, res) => {
    try {
      const { room, member, isStudent, isTeacherOwner } = await getAssignmentMember(req.params.roomId, req.collaborationUser);
      if (!room) return res.status(404).json({ error: 'Teacher assignment not found.' });
      if (!isStudent && !isTeacherOwner) return res.status(403).json({ error: 'Join this assignment to access its workspace.' });
      const assignment = await getAssignment(supabase, room.id);
      if (!assignment) return res.status(404).json({ error: 'This assignment is no longer available.' });
      return res.json({ assignment, role: member.role });
    } catch (error) {
      if (isMissingCollaborationSchemaError(error)) {
        const schemaError = collaborationSchemaError();
        return res.status(schemaError.status).json({ error: schemaError.message });
      }
      console.error('[collaboration] assignment details failed:', error?.message || error);
      return res.status(500).json({ error: 'Unable to load this assignment.' });
    }
  });

  router.get('/assignments/:roomId/progress', async (req, res) => {
    try {
      const { room, isStudent } = await getAssignmentMember(req.params.roomId, req.collaborationUser);
      if (!room) return res.status(404).json({ error: 'Teacher assignment not found.' });
      if (!isStudent) return res.status(403).json({ error: 'Only an enrolled student can view personal assignment progress.' });
      const [progress, { data: submissions, error: submissionError }, { data: executionHistory, error: executionError }] = await Promise.all([
        readProgress(room.id, req.collaborationUser.id),
        supabase.from('collaboration_assignment_submissions').select('id, assignment_id, workspace_id, code, attempt, submitted_at')
          .eq('room_id', room.id).eq('user_id', req.collaborationUser.id).order('submitted_at', { ascending: false }),
        supabase.from('collaboration_assignment_runs').select('id, has_error, ran_at')
          .eq('room_id', room.id).eq('user_id', req.collaborationUser.id).order('ran_at', { ascending: false }),
      ]);
      if (submissionError) throw submissionError;
      if (executionError) throw executionError;
      return res.json({ progress, submissions: submissions || [], executionHistory: executionHistory || [] });
    } catch (error) {
      if (isMissingCollaborationSchemaError(error)) {
        const schemaError = collaborationSchemaError();
        return res.status(schemaError.status).json({ error: schemaError.message });
      }
      console.error('[collaboration] student progress load failed:', error?.message || error);
      return res.status(500).json({ error: 'Unable to load assignment progress.' });
    }
  });

  router.post('/assignments/:roomId/run', async (req, res) => {
    const body = assignmentRunSchema.safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: 'Invalid code execution result.' });
    try {
      const { room, isStudent } = await getAssignmentMember(req.params.roomId, req.collaborationUser);
      if (!room) return res.status(404).json({ error: 'Teacher assignment not found.' });
      if (!isStudent) return res.status(403).json({ error: 'Only enrolled students can record assignment runs.' });
      const ranAt = new Date().toISOString();
      const { data: run, error: runError } = await supabase.from('collaboration_assignment_runs').insert({
        room_id: room.id,
        user_id: req.collaborationUser.id,
        has_error: body.data.hasError,
        ran_at: ranAt,
      }).select('id, has_error, ran_at').maybeSingle();
      if (runError) throw runError;
      const current = await readProgress(room.id, req.collaborationUser.id);
      const progress = {
        ...current,
        code_runs: current.code_runs + 1,
        errors: current.errors + (body.data.hasError ? 1 : 0),
        updated_at: ranAt,
      };
      const { error } = await supabase.from('collaboration_assignment_progress').upsert(progress, { onConflict: 'room_id,user_id' });
      if (error) throw error;
      return res.json({ progress, run });
    } catch (error) {
      if (isMissingCollaborationSchemaError(error)) {
        const schemaError = collaborationSchemaError();
        return res.status(schemaError.status).json({ error: schemaError.message });
      }
      console.error('[collaboration] assignment run tracking failed:', error?.message || error);
      return res.status(500).json({ error: 'Unable to record this assignment run.' });
    }
  });

  router.post('/assignments/:roomId/save', async (req, res) => {
    const body = assignmentCodeSchema.safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: 'Code must be 20,000 characters or fewer.' });
    try {
      const { room, isStudent } = await getAssignmentMember(req.params.roomId, req.collaborationUser);
      if (!room) return res.status(404).json({ error: 'Teacher assignment not found.' });
      if (!isStudent) return res.status(403).json({ error: 'Only enrolled students can save assignment work.' });
      const { data: workspace, error: workspaceError } = await supabase.from('collaboration_assignment_workspaces')
        .select('room_id').eq('room_id', room.id).eq('user_id', req.collaborationUser.id).maybeSingle();
      if (workspaceError) throw workspaceError;
      if (!workspace) return res.status(409).json({ error: 'The personal workspace is not ready. Reconnect and try again.' });
      const savedAt = new Date().toISOString();
      const { error } = await supabase.from('collaboration_assignment_workspaces').update({
        saved_code: body.data.code,
        saved_at: savedAt,
        updated_at: savedAt,
      }).eq('room_id', room.id).eq('user_id', req.collaborationUser.id);
      if (error) throw error;
      return res.json({ savedAt });
    } catch (error) {
      if (isMissingCollaborationSchemaError(error)) {
        const schemaError = collaborationSchemaError();
        return res.status(schemaError.status).json({ error: schemaError.message });
      }
      console.error('[collaboration] assignment save failed:', error?.message || error);
      return res.status(500).json({ error: 'Unable to save assignment work.' });
    }
  });

  router.post('/assignments/:roomId/submit', async (req, res) => {
    const body = assignmentCodeSchema.safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: 'Code must be 20,000 characters or fewer.' });
    try {
      const { room, isStudent } = await getAssignmentMember(req.params.roomId, req.collaborationUser);
      if (!room) return res.status(404).json({ error: 'Teacher assignment not found.' });
      if (!isStudent) return res.status(403).json({ error: 'Only enrolled students can submit assignment work.' });
      const current = await readProgress(room.id, req.collaborationUser.id);
      const attempt = current.attempts + 1;
      const submittedAt = new Date().toISOString();
      const { data: workspace, error: workspaceError } = await supabase.from('collaboration_assignment_workspaces')
        .select('id').eq('room_id', room.id).eq('user_id', req.collaborationUser.id).maybeSingle();
      if (workspaceError) throw workspaceError;
      const { data: submission, error: submissionError } = await supabase.from('collaboration_assignment_submissions').insert({
        room_id: room.id,
        assignment_id: room.id,
        workspace_id: workspace?.id || null,
        user_id: req.collaborationUser.id,
        code: body.data.code,
        attempt,
        submitted_at: submittedAt,
      }).select('id, code, attempt, submitted_at').maybeSingle();
      if (submissionError) throw submissionError;
      const progress = {
        ...current,
        attempts: attempt,
        submission_status: 'Submitted',
        submitted_at: submittedAt,
        updated_at: submittedAt,
      };
      const { error: progressError } = await supabase.from('collaboration_assignment_progress').upsert(progress, { onConflict: 'room_id,user_id' });
      if (progressError) throw progressError;
      return res.status(201).json({ submission, progress });
    } catch (error) {
      if (isMissingCollaborationSchemaError(error)) {
        const schemaError = collaborationSchemaError();
        return res.status(schemaError.status).json({ error: schemaError.message });
      }
      console.error('[collaboration] assignment submission failed:', error?.message || error);
      return res.status(500).json({ error: 'Unable to submit this assignment.' });
    }
  });

  router.post('/assignments/:roomId/feedback-requests', async (req, res) => {
    const body = assignmentFeedbackRequestSchema.safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: 'Feedback request messages must be 2,000 characters or fewer.' });
    try {
      const { room, isStudent } = await getAssignmentMember(req.params.roomId, req.collaborationUser);
      if (!room) return res.status(404).json({ error: 'Teacher assignment not found.' });
      if (!isStudent) return res.status(403).json({ error: 'Only enrolled students can request assignment feedback.' });
      const { data, error } = await supabase.from('collaboration_assignment_feedback_requests').insert({
        room_id: room.id,
        user_id: req.collaborationUser.id,
        message: body.data.message,
        status: 'pending',
      }).select('id, status, requested_at, message').maybeSingle();
      if (error) throw error;
      return res.status(201).json({ request: data });
    } catch (error) {
      if (isMissingCollaborationSchemaError(error)) {
        const schemaError = collaborationSchemaError();
        return res.status(schemaError.status).json({ error: schemaError.message });
      }
      console.error('[collaboration] feedback request failed:', error?.message || error);
      return res.status(500).json({ error: 'Unable to request teacher feedback.' });
    }
  });

  router.get('/assignments/:roomId/feedback', async (req, res) => {
    try {
      const { room, isStudent } = await getAssignmentMember(req.params.roomId, req.collaborationUser);
      if (!room) return res.status(404).json({ error: 'Teacher assignment not found.' });
      if (!isStudent) return res.status(403).json({ error: 'Only enrolled students can view personal teacher feedback.' });
      const [{ data: feedback, error }, { data: requests, error: requestError }] = await Promise.all([
        supabase.from('collaboration_assignment_feedback').select('id, author_id, message, concept, is_read, created_at').eq('room_id', room.id).eq('user_id', req.collaborationUser.id),
        supabase.from('collaboration_assignment_feedback_requests').select('id, status, requested_at, message').eq('room_id', room.id).eq('user_id', req.collaborationUser.id),
      ]);
      if (error) throw error;
      if (requestError) throw requestError;
      return res.json({ feedback: feedback || [], requests: requests || [] });
    } catch (error) {
      if (isMissingCollaborationSchemaError(error)) {
        const schemaError = collaborationSchemaError();
        return res.status(schemaError.status).json({ error: schemaError.message });
      }
      console.error('[collaboration] assignment feedback load failed:', error?.message || error);
      return res.status(500).json({ error: 'Unable to load teacher feedback.' });
    }
  });

  router.post('/assignments/:roomId/feedback/:feedbackId/read', async (req, res) => {
    const feedbackId = z.string().uuid().safeParse(req.params.feedbackId);
    if (!feedbackId.success) return res.status(400).json({ error: 'Invalid feedback entry.' });
    try {
      const { room, isStudent } = await getAssignmentMember(req.params.roomId, req.collaborationUser);
      if (!room) return res.status(404).json({ error: 'Teacher assignment not found.' });
      if (!isStudent) return res.status(403).json({ error: 'Only the feedback recipient can mark it as read.' });
      const { data, error } = await supabase.from('collaboration_assignment_feedback').update({ is_read: true })
        .eq('id', feedbackId.data).eq('room_id', room.id).eq('user_id', req.collaborationUser.id)
        .select('id').maybeSingle();
      if (error) throw error;
      if (!data) return res.status(404).json({ error: 'Feedback entry not found.' });
      return res.json({ read: true });
    } catch (error) {
      if (isMissingCollaborationSchemaError(error)) {
        const schemaError = collaborationSchemaError();
        return res.status(schemaError.status).json({ error: schemaError.message });
      }
      console.error('[collaboration] feedback read update failed:', error?.message || error);
      return res.status(500).json({ error: 'Unable to update feedback status.' });
    }
  });

  router.get('/assignments/:roomId/monitoring', async (req, res) => {
    try {
      const { room, isTeacherOwner } = await getAssignmentMember(req.params.roomId, req.collaborationUser);
      if (!room) return res.status(404).json({ error: 'Teacher assignment not found.' });
      if (!isTeacherOwner) return res.status(403).json({ error: 'Only the teacher who created this assignment can view student work.' });
      const { data: members, error: membersError } = await supabase.from('collaboration_room_members')
        .select('user_id, joined_at').eq('room_id', room.id).eq('role', 'member');
      if (membersError) throw membersError;
      const students = await Promise.all((members || []).map(async ({ user_id: userId, joined_at: joinedAt }) => {
        const [progress, workspaceResult, submissionResult, executionResult, feedbackResult, requestResult] = await Promise.all([
          readProgress(room.id, userId),
          supabase.from('collaboration_assignment_workspaces').select('id, content_state, saved_code, saved_at').eq('room_id', room.id).eq('user_id', userId).maybeSingle(),
          supabase.from('collaboration_assignment_submissions').select('id, assignment_id, workspace_id, code, attempt, submitted_at').eq('room_id', room.id).eq('user_id', userId).order('submitted_at', { ascending: false }),
          supabase.from('collaboration_assignment_runs').select('id, has_error, ran_at').eq('room_id', room.id).eq('user_id', userId).order('ran_at', { ascending: false }),
          supabase.from('collaboration_assignment_feedback').select('id, message, concept, is_read, created_at').eq('room_id', room.id).eq('user_id', userId),
          supabase.from('collaboration_assignment_feedback_requests').select('id, status, requested_at, message').eq('room_id', room.id).eq('user_id', userId).order('requested_at', { ascending: false }),
        ]);
        if (workspaceResult.error) throw workspaceResult.error;
        if (submissionResult.error) throw submissionResult.error;
        if (executionResult.error) throw executionResult.error;
        if (feedbackResult.error) throw feedbackResult.error;
        if (requestResult.error) throw requestResult.error;
        const privateDocument = workspaceResult.data?.content_state
          ? restoreCollaborationDocument(workspaceResult.data.content_state)
          : null;
        const currentCode = privateDocument?.getText('code').toString() || '';
        privateDocument?.destroy();
        return {
          userId,
          joinedAt,
          progress,
          workspaceId: workspaceResult.data?.id || null,
          savedCode: workspaceResult.data?.saved_code || '',
          currentCode,
          savedAt: workspaceResult.data?.saved_at || null,
          submissions: submissionResult.data || [],
          executionHistory: executionResult.data || [],
          feedback: feedbackResult.data || [],
          feedbackRequests: requestResult.data || [],
        };
      }));
      return res.json({ students });
    } catch (error) {
      if (isMissingCollaborationSchemaError(error)) {
        const schemaError = collaborationSchemaError();
        return res.status(schemaError.status).json({ error: schemaError.message });
      }
      console.error('[collaboration] assignment monitoring failed:', error?.message || error);
      return res.status(500).json({ error: 'Unable to load assignment monitoring data.' });
    }
  });

  router.post('/assignments/:roomId/monitoring/:userId/feedback', async (req, res) => {
    const targetUserId = z.string().uuid().safeParse(req.params.userId);
    const body = assignmentFeedbackSchema.safeParse(req.body);
    if (!targetUserId.success || !body.success) return res.status(400).json({ error: 'Enter valid feedback for a student.' });
    try {
      const { room, isTeacherOwner } = await getAssignmentMember(req.params.roomId, req.collaborationUser);
      if (!room) return res.status(404).json({ error: 'Teacher assignment not found.' });
      if (!isTeacherOwner) return res.status(403).json({ error: 'Only the teacher who created this assignment can give feedback.' });
      const { data: student, error: studentError } = await supabase.from('collaboration_room_members')
        .select('user_id').eq('room_id', room.id).eq('user_id', targetUserId.data).eq('role', 'member').maybeSingle();
      if (studentError) throw studentError;
      if (!student) return res.status(404).json({ error: 'Student is not enrolled in this assignment.' });
      const { data: feedback, error } = await supabase.from('collaboration_assignment_feedback').insert({
        room_id: room.id,
        user_id: targetUserId.data,
        author_id: req.collaborationUser.id,
        message: body.data.message,
        concept: body.data.concept || null,
      }).select('id, message, concept, created_at').maybeSingle();
      if (error) throw error;
      const { error: requestUpdateError } = await supabase.from('collaboration_assignment_feedback_requests').update({ status: 'fulfilled' })
        .eq('room_id', room.id).eq('user_id', targetUserId.data).eq('status', 'pending');
      if (requestUpdateError) throw requestUpdateError;
      return res.status(201).json({ feedback });
    } catch (error) {
      if (isMissingCollaborationSchemaError(error)) {
        const schemaError = collaborationSchemaError();
        return res.status(schemaError.status).json({ error: schemaError.message });
      }
      console.error('[collaboration] assignment feedback submission failed:', error?.message || error);
      return res.status(500).json({ error: 'Unable to send assignment feedback.' });
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
      room_type: 'collaborative',
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
        room: { id, publicId: publicRoomId, roomCode: publicRoomId, language: room.language, roomType: 'collaborative' },
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
      if (room.room_type === 'teacher_assignment') return res.status(403).json({ error: 'Join teacher assignments with their assignment code.' });
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
      if (room.room_type === 'teacher_assignment') return res.status(403).json({ error: 'Assignment sharing is managed from the teacher dashboard.' });
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
      if (room.room_type === 'teacher_assignment') return res.status(403).json({ error: 'Assignment rooms do not use teacher-invite access.' });
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
      if (room.room_type === 'teacher_assignment') return res.status(403).json({ error: 'Assignment students join with the code shared by their teacher.' });

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
      if (room.room_type === 'teacher_assignment') return res.status(403).json({ error: 'Assignment rooms do not use access requests.' });
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
      if (room.room_type === 'teacher_assignment') return res.status(403).json({ error: 'Assignment rooms do not use access requests.' });
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
      if (room.room_type === 'teacher_assignment') return res.status(403).json({ error: 'Assignment rooms do not use access requests.' });
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
      if (room.room_type === 'teacher_assignment') return res.status(403).json({ error: 'Assignment rooms do not use access requests.' });
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
      if (room.room_type === 'teacher_assignment') return res.status(403).json({ error: 'Use assignment-specific private feedback.' });
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
      if (room.room_type === 'teacher_assignment') return res.status(403).json({ error: 'Use assignment-specific private feedback.' });
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

      if (room.room_type === 'teacher_assignment') {
        const isAssignedTeacher = userRole(req.collaborationUser) === 'teacher'
          && room.teacher_id === req.collaborationUser.id
          && member.role === 'owner';
        const isEnrolledStudent = userRole(req.collaborationUser) === 'student' && member.role === 'member';
        if (!isAssignedTeacher && !isEnrolledStudent) {
          return res.status(403).json({ error: 'You do not have access to this assignment workspace.' });
        }
      }

      const assignment = room.room_type === 'teacher_assignment' ? await getAssignment(supabase, room.id) : null;
      return res.json({ room: {
        id: room.id,
        publicId: room.room_code || room.id,
        roomCode: room.room_code || room.id,
        roomType: room.room_type || 'collaborative',
        language: room.language,
        teacherId: room.teacher_id,
        role: member.role,
        assignment,
      } });
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
      const update = roomState.assignment
        ? roomState.persisted
          ? supabase.from('collaboration_assignment_workspaces').update({
            content_state: contentState,
            updated_at: new Date().toISOString(),
          }).eq('room_id', roomId).eq('user_id', roomState.userId)
          : null
        : supabase.from('collaboration_rooms').update({
          content_state: contentState,
          updated_at: new Date().toISOString(),
        }).eq('id', roomId);
      if (!update) return true;
      const { error } = await update;
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

  const getRoomState = async (roomId, userId, role) => {
    const resolvedRoom = await resolveRoomRecord(supabase, roomId);
    if (!resolvedRoom) return null;
    const isAssignment = resolvedRoom.room_type === 'teacher_assignment';
    const roomKey = isAssignment ? `${resolvedRoom.id}:${userId}` : resolvedRoom.id;
    const existing = rooms.get(roomKey);
    if (existing) return existing;
    const pendingLoad = loadingRooms.get(roomKey);
    if (pendingLoad) return pendingLoad;

    const load = (async () => {
      const resolvedId = isAssignment ? resolvedRoom.id : roomKey;
      const { data: roomRecord, error: roomError } = await supabase
        .from('collaboration_rooms')
        .select('id, room_code, language, room_type, content_state')
        .eq('id', resolvedId)
        .maybeSingle();
      if (roomError) throw roomError;
      if (!roomRecord) return null;

      let contentState = roomRecord.content_state;
      let persisted = true;
      if (isAssignment) {
        if (role === 'owner') {
          contentState = '';
          persisted = false;
        } else {
          const { data: workspace, error: workspaceError } = await supabase.from('collaboration_assignment_workspaces')
            .select('content_state').eq('room_id', resolvedId).eq('user_id', userId).maybeSingle();
          if (workspaceError) throw workspaceError;
          contentState = workspace?.content_state || '';
        }
      }
      const document = restoreCollaborationDocument(contentState);
      if (isAssignment && role !== 'owner') {
        const { error: workspaceError } = await supabase.from('collaboration_assignment_workspaces').upsert({
          room_id: resolvedId,
          user_id: userId,
          content_state: encodeCollaborationState(document),
        }, { onConflict: 'room_id,user_id' });
        if (workspaceError) {
          document.destroy();
          throw workspaceError;
        }
      }
      const roomState = { document, language: roomRecord.language, clients: new Set(), saveTimer: null, assignment: isAssignment, persisted, userId };
      document.on('update', (update, origin) => {
        const encodedUpdate = encodeCollaborationUpdate(update);
        for (const client of roomState.clients) {
          if (client !== origin) sendJson(client, { type: 'update', update: encodedUpdate });
        }
        if (roomState.saveTimer) clearTimeout(roomState.saveTimer);
        roomState.saveTimer = setTimeout(() => {
          roomState.saveTimer = null;
          void persistRoom(resolvedId, roomState);
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

    const isAssignment = resolvedRoom.room_type === 'teacher_assignment';
    const isAssignmentTeacher = isAssignment
      && userRole(user) === 'teacher'
      && resolvedRoom.teacher_id === user.id
      && member.role === 'owner';
    const isAssignmentStudent = isAssignment && userRole(user) === 'student' && member.role === 'member';
    if (isAssignment && !isAssignmentTeacher && !isAssignmentStudent) {
      socket.close(4403, 'Assignment role required');
      return;
    }

    const roomStateRole = isAssignmentTeacher ? 'owner' : isAssignment ? 'member' : member.role;
    const roomState = await getRoomState(resolvedRoom.id, user.id, roomStateRole);
    if (!roomState) {
      socket.close(4404, 'Room not found');
      return;
    }
    socket.roomId = resolvedRoom.id;
    socket.roomStateKey = resolvedRoom.room_type === 'teacher_assignment' ? `${resolvedRoom.id}:${user.id}` : resolvedRoom.id;
    socket.roomState = roomState;
    socket.userId = user.id;
    socket.role = isAssignmentTeacher ? 'teacher' : member.role === 'teacher' ? 'teacher' : member.role === 'owner' ? 'owner' : 'member';
    socket.participantId = randomUUID();
    socket.participantName = displayName(user);
    roomState.clients.add(socket);
    sendJson(socket, {
      type: 'sync',
      update: encodeCollaborationUpdate(Y.encodeStateAsUpdate(roomState.document)),
      language: roomState.language,
      roomType: resolvedRoom.room_type || 'collaborative',
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
          if (!persisted || roomState.clients.size || rooms.get(socket.roomStateKey) !== roomState) return;
          rooms.delete(socket.roomStateKey);
          roomState.document.destroy();
        });
      }
    });
  });

  return webSocketServer;
};