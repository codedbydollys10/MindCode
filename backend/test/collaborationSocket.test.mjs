import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
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
  tokenD: { id: 'user-d', email: 'd@example.test', user_metadata: { name: 'Dana' } },
  assignmentTeacher: { id: '10000000-0000-4000-8000-000000000001', email: 'teacher@example.test', app_metadata: { role: 'teacher' }, user_metadata: { name: 'Terry Teacher' } },
  assignmentTeacherOther: { id: '10000000-0000-4000-8000-000000000002', email: 'other-teacher@example.test', app_metadata: { role: 'teacher' }, user_metadata: { name: 'Other Teacher' } },
  assignmentStudentA: { id: '20000000-0000-4000-8000-000000000001', email: 'student-a@example.test', app_metadata: { role: 'student' }, user_metadata: { name: 'Student A' } },
  assignmentStudentB: { id: '20000000-0000-4000-8000-000000000002', email: 'student-b@example.test', app_metadata: { role: 'student' }, user_metadata: { name: 'Student B' } },
};

const createSupabaseMock = () => {
  const rooms = new Map();
  const members = new Map();
  const joinRequests = new Map();
  const teacherInvites = new Map();
  const feedback = new Map();
  const assignments = new Map();
  const workspaces = new Map();
  const assignmentProgress = new Map();
  const assignmentSubmissions = new Map();
  const assignmentRuns = new Map();
  const assignmentFeedbackRequests = new Map();
  const assignmentFeedback = new Map();
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
        select() { return builder; },
        insert(value) { action = 'insert'; payload = value; return builder; },
        upsert(value) { action = 'upsert'; payload = value; return builder; },
        update(value) { action = 'update'; payload = value; return builder; },
        delete() { action = 'delete'; return builder; },
        eq(field, value) { filters[field] = value; return builder; },
        is(field, value) { filters[field] = value; return builder; },
        order() { return builder; },
        maybeSingle() { return execute(true); },
        then(resolve, reject) { return execute(false).then(resolve, reject); },
      };

      const matches = (row) => Object.entries(filters).every(([field, value]) => row?.[field] === value);
      const execute = async (single) => {
        const tableMap = {
          collaboration_rooms: rooms,
          collaboration_room_members: members,
          collaboration_room_join_requests: joinRequests,
          collaboration_room_teacher_invites: teacherInvites,
          collaboration_room_feedback: feedback,
          collaboration_assignments: assignments,
          collaboration_assignment_workspaces: workspaces,
          collaboration_assignment_progress: assignmentProgress,
          collaboration_assignment_submissions: assignmentSubmissions,
          collaboration_assignment_runs: assignmentRuns,
          collaboration_assignment_feedback_requests: assignmentFeedbackRequests,
          collaboration_assignment_feedback: assignmentFeedback,
        };
        const rows = tableMap[table];
        if (table === 'collaboration_rooms' && filters.id && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(filters.id)) {
          return { data: null, error: new Error(`invalid input syntax for type uuid: "${filters.id}"`) };
        }
        if (action === 'insert') {
          const row = { id: randomUUID(), ...payload };
          if (table === 'collaboration_rooms') rooms.set(row.id, row);
          else if (table === 'collaboration_room_members') members.set(keyForMember(row.room_id, row.user_id), row);
          else if (table === 'collaboration_room_join_requests') joinRequests.set(keyForMember(row.room_id, row.user_id), row);
          else if (table === 'collaboration_room_teacher_invites') {
            row.redeemed_at ??= null;
            teacherInvites.set(row.id, row);
          } else if (table === 'collaboration_room_feedback') feedback.set(row.id, row);
          else if (table === 'collaboration_assignments') assignments.set(row.room_id, row);
          else if (table === 'collaboration_assignment_workspaces') workspaces.set(keyForMember(row.room_id, row.user_id), row);
          else if (table === 'collaboration_assignment_progress') assignmentProgress.set(keyForMember(row.room_id, row.user_id), row);
          else if (table === 'collaboration_assignment_submissions') assignmentSubmissions.set(row.id, row);
          else if (table === 'collaboration_assignment_runs') assignmentRuns.set(row.id, row);
          else if (table === 'collaboration_assignment_feedback_requests') assignmentFeedbackRequests.set(row.id, row);
          else assignmentFeedback.set(row.id, row);
          return { data: row, error: null };
        }
        if (action === 'upsert') {
          const key = table === 'collaboration_rooms'
            ? payload.id
            : table === 'collaboration_assignments'
              ? payload.room_id
              : ['collaboration_room_members', 'collaboration_room_join_requests', 'collaboration_assignment_workspaces', 'collaboration_assignment_progress'].includes(table)
                ? keyForMember(payload.room_id, payload.user_id)
                : payload.id;
          const target = tableMap[table];
          if (!target) throw new Error(`Unknown table: ${table}`);
          const row = { ...target.get(key), ...payload };
          target.set(key, row);
          return { data: row, error: null };
        }
        const found = [...rows.values()].filter(matches);
        if (action === 'select') return { data: single ? found[0] || null : found, error: null };
        if (action === 'update') {
          for (const row of found) Object.assign(row, payload);
          return { data: single ? found[0] || null : found, error: null };
        }
        if (action === 'delete') {
          for (const row of found) {
            if (table === 'collaboration_rooms') rooms.delete(row.id);
            else if (table === 'collaboration_room_members') members.delete(keyForMember(row.room_id, row.user_id));
            else if (table === 'collaboration_room_join_requests') joinRequests.delete(keyForMember(row.room_id, row.user_id));
            else if (table === 'collaboration_room_teacher_invites') teacherInvites.delete(row.id);
            else if (table === 'collaboration_room_feedback') feedback.delete(row.id);
            else if (table === 'collaboration_assignments') assignments.delete(row.room_id);
            else if (table === 'collaboration_assignment_workspaces') workspaces.delete(keyForMember(row.room_id, row.user_id));
            else if (table === 'collaboration_assignment_progress') assignmentProgress.delete(keyForMember(row.room_id, row.user_id));
            else if (table === 'collaboration_assignment_submissions') assignmentSubmissions.delete(row.id);
            else if (table === 'collaboration_assignment_runs') assignmentRuns.delete(row.id);
            else if (table === 'collaboration_assignment_feedback_requests') assignmentFeedbackRequests.delete(row.id);
            else assignmentFeedback.delete(row.id);
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

test('room creation returns a shareable public room code and resolves room lookups by that code', async () => {
  const { supabase } = createSupabaseMock();
  const app = express();
  app.use(express.json());
  app.use('/api/collaboration', createCollaborationRouter({ supabase }));
  const server = createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const apiBase = `http://127.0.0.1:${address.port}`;
  const createResponse = await fetch(`${apiBase}/api/collaboration/rooms`, {
    method: 'POST',
    headers: { authorization: 'Bearer tokenA', 'content-type': 'application/json' },
    body: JSON.stringify({ language: 'python' }),
  });
  assert.equal(createResponse.status, 201);
  const created = await createResponse.json();
  assert.equal(created.room.roomType, 'collaborative');
  assert.match(created.room.publicId || created.room.roomCode || created.room.id, /^MC-[A-Z0-9]{6}$/);

  const lookupResponse = await fetch(`${apiBase}/api/collaboration/rooms/${created.room.publicId || created.room.roomCode}`, {
    headers: { authorization: 'Bearer tokenA' },
  });
  assert.equal(lookupResponse.status, 200);
  await new Promise((resolve) => server.close(resolve));
});

test('assignment rooms keep student work private and scope monitoring and feedback to the owner and recipient', async (t) => {
  const { supabase } = createSupabaseMock();
  const app = express();
  app.use(express.json());
  app.use('/api/collaboration', createCollaborationRouter({ supabase }));
  const server = createServer(app);
  const webSocketServer = attachCollaborationWebSocket({ server, supabase, isAllowedOrigin: () => true });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const apiBase = `http://127.0.0.1:${server.address().port}`;
  const headersFor = (token) => ({ authorization: `Bearer ${token}`, 'content-type': 'application/json' });
  const clients = [];
  t.after(async () => {
    await Promise.all(clients.map(closeClient));
    webSocketServer?.close();
    await new Promise((resolve) => server.close(resolve));
  });

  const studentCreateResponse = await fetch(`${apiBase}/api/collaboration/assignments`, {
    method: 'POST',
    headers: headersFor('assignmentStudentA'),
    body: JSON.stringify({ roomName: 'Not a teacher', title: 'Blocked', language: 'python' }),
  });
  assert.equal(studentCreateResponse.status, 403);
  const studentListResponse = await fetch(`${apiBase}/api/collaboration/assignments`, {
    headers: headersFor('assignmentStudentA'),
  });
  assert.equal(studentListResponse.status, 403);

  const createResponse = await fetch(`${apiBase}/api/collaboration/assignments`, {
    method: 'POST',
    headers: headersFor('assignmentTeacher'),
    body: JSON.stringify({ roomName: 'CS 101', title: 'Loops practice', instructions: 'Write a for loop.', language: 'python' }),
  });
  assert.equal(createResponse.status, 201);
  const { room } = await createResponse.json();
  assert.equal(room.roomType, 'teacher_assignment');

  const lookupResponse = await fetch(`${apiBase}/api/collaboration/assignments/lookup`, {
    method: 'POST',
    headers: headersFor('assignmentStudentA'),
    body: JSON.stringify({ roomCode: room.publicId }),
  });
  assert.equal(lookupResponse.status, 200);
  assert.equal((await lookupResponse.json()).assignment.title, 'Loops practice');

  for (const token of ['assignmentStudentA', 'assignmentStudentB']) {
    const joinResponse = await fetch(`${apiBase}/api/collaboration/assignments/${room.id}/join`, {
      method: 'POST',
      headers: headersFor(token),
    });
    assert.equal(joinResponse.status, 200);
  }

  const studentA = await connectClient(`ws://127.0.0.1:${server.address().port}/collaboration`, room.publicId, 'assignmentStudentA');
  const studentB = await connectClient(`ws://127.0.0.1:${server.address().port}/collaboration`, room.publicId, 'assignmentStudentB');
  clients.push(studentA, studentB);
  studentA.document.getText('code').insert(0, 'print("private solution")');
  studentA.socket.send(JSON.stringify({
    type: 'update',
    update: Buffer.from(Y.encodeStateAsUpdate(studentA.document)).toString('base64'),
  }));
  await new Promise((resolve) => setTimeout(resolve, 900));
  assert.equal(studentB.document.getText('code').toString(), '');

  const saveResponse = await fetch(`${apiBase}/api/collaboration/assignments/${room.id}/save`, {
    method: 'POST',
    headers: headersFor('assignmentStudentA'),
    body: JSON.stringify({ code: 'print("private solution")' }),
  });
  assert.equal(saveResponse.status, 200);
  const runResponse = await fetch(`${apiBase}/api/collaboration/assignments/${room.id}/run`, {
    method: 'POST',
    headers: headersFor('assignmentStudentA'),
    body: JSON.stringify({ hasError: true }),
  });
  const runBody = await runResponse.json();
  assert.equal(runBody.progress.errors, 1);
  assert.equal(runBody.run.has_error, true);
  const submitResponse = await fetch(`${apiBase}/api/collaboration/assignments/${room.id}/submit`, {
    method: 'POST',
    headers: headersFor('assignmentStudentA'),
    body: JSON.stringify({ code: 'print("private solution")' }),
  });
  assert.equal((await submitResponse.json()).progress.attempts, 1);
  const feedbackRequestResponse = await fetch(`${apiBase}/api/collaboration/assignments/${room.id}/feedback-requests`, {
    method: 'POST',
    headers: headersFor('assignmentStudentA'),
    body: JSON.stringify({ message: 'Could you explain the loop condition?' }),
  });
  assert.equal(feedbackRequestResponse.status, 201);
  assert.equal((await feedbackRequestResponse.json()).request.message, 'Could you explain the loop condition?');

  const forbiddenMonitoring = await fetch(`${apiBase}/api/collaboration/assignments/${room.id}/monitoring`, {
    headers: headersFor('assignmentStudentA'),
  });
  assert.equal(forbiddenMonitoring.status, 403);
  const otherTeacherMonitoring = await fetch(`${apiBase}/api/collaboration/assignments/${room.id}/monitoring`, {
    headers: headersFor('assignmentTeacherOther'),
  });
  assert.equal(otherTeacherMonitoring.status, 403);
  const teacherFeedbackResponse = await fetch(`${apiBase}/api/collaboration/assignments/${room.id}/monitoring/${usersByToken.assignmentStudentA.id}/feedback`, {
    method: 'POST',
    headers: headersFor('assignmentTeacher'),
    body: JSON.stringify({ message: 'Check the loop condition.', concept: 'For loops' }),
  });
  assert.equal(teacherFeedbackResponse.status, 201);

  const studentAFeedback = await fetch(`${apiBase}/api/collaboration/assignments/${room.id}/feedback`, {
    headers: headersFor('assignmentStudentA'),
  });
  const studentBFeedback = await fetch(`${apiBase}/api/collaboration/assignments/${room.id}/feedback`, {
    headers: headersFor('assignmentStudentB'),
  });
  const studentAFeedbackBody = await studentAFeedback.json();
  const studentBFeedbackBody = await studentBFeedback.json();
  assert.equal(studentAFeedbackBody.feedback.length, 1);
  assert.equal(studentBFeedbackBody.feedback.length, 0);
  assert.equal(studentAFeedbackBody.requests[0].message, 'Could you explain the loop condition?');
  assert.equal(studentBFeedbackBody.requests.length, 0);
  const studentBProgress = await fetch(`${apiBase}/api/collaboration/assignments/${room.id}/progress`, {
    headers: headersFor('assignmentStudentB'),
  });
  const studentBHistory = await studentBProgress.json();
  assert.equal(studentBHistory.progress.attempts, 0);
  assert.equal(studentBHistory.submissions.length, 0);
  assert.equal(studentBHistory.executionHistory.length, 0);
  const teacherView = await fetch(`${apiBase}/api/collaboration/assignments/${room.id}/monitoring`, {
    headers: headersFor('assignmentTeacher'),
  });
  const { students } = await teacherView.json();
  assert.equal(teacherView.status, 200);
  assert.equal(students.find((student) => student.userId === usersByToken.assignmentStudentA.id).currentCode, 'print("private solution")');
  assert.equal(students.find((student) => student.userId === usersByToken.assignmentStudentB.id).currentCode, '');
  assert.equal(students.find((student) => student.userId === usersByToken.assignmentStudentA.id).executionHistory.length, 1);
  assert.equal(students.find((student) => student.userId === usersByToken.assignmentStudentA.id).feedbackRequests[0].message, 'Could you explain the loop condition?');
  const teacherRooms = await fetch(`${apiBase}/api/collaboration/assignments`, {
    headers: headersFor('assignmentTeacher'),
  });
  assert.equal((await teacherRooms.json()).assignments.length, 1);
});

test('room owners approve or reject access requests before non-members can enter', async (t) => {
  const { supabase } = createSupabaseMock();
  const app = express();
  app.use(express.json());
  app.use('/api/collaboration', createCollaborationRouter({ supabase }));
  const server = createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const apiBase = `http://127.0.0.1:${server.address().port}`;
  const headersFor = (token) => ({ authorization: `Bearer ${token}`, 'content-type': 'application/json' });

  const createResponse = await fetch(`${apiBase}/api/collaboration/rooms`, {
    method: 'POST',
    headers: headersFor('tokenA'),
    body: JSON.stringify({ language: 'python' }),
  });
  const created = await createResponse.json();
  const roomId = created.room.publicId;

  const requestResponse = await fetch(`${apiBase}/api/collaboration/rooms/${roomId}/requests`, {
    method: 'POST',
    headers: headersFor('tokenB'),
  });
  assert.equal(requestResponse.status, 202);
  assert.deepEqual(await requestResponse.json(), { status: 'pending' });

  const ownerQueueResponse = await fetch(`${apiBase}/api/collaboration/rooms/${roomId}/requests`, {
    headers: headersFor('tokenA'),
  });
  const ownerQueue = await ownerQueueResponse.json();
  assert.equal(ownerQueueResponse.status, 200);
  assert.equal(ownerQueue.requests[0].requester_name, 'Bea');
  assert.equal((await fetch(`${apiBase}/api/collaboration/rooms/${roomId}/requests`, {
    headers: headersFor('tokenB'),
  })).status, 403);

  const acceptResponse = await fetch(`${apiBase}/api/collaboration/rooms/${roomId}/requests/${ownerQueue.requests[0].id}`, {
    method: 'PATCH',
    headers: headersFor('tokenA'),
    body: JSON.stringify({ decision: 'accepted' }),
  });
  assert.equal(acceptResponse.status, 200);
  assert.equal((await acceptResponse.json()).request.status, 'accepted');
  assert.equal((await fetch(`${apiBase}/api/collaboration/rooms/${roomId}`, {
    headers: headersFor('tokenB'),
  })).status, 200);

  const rejectedRequestResponse = await fetch(`${apiBase}/api/collaboration/rooms/${roomId}/requests`, {
    method: 'POST',
    headers: headersFor('tokenC'),
  });
  assert.equal(rejectedRequestResponse.status, 202);
  const refreshedQueue = await (await fetch(`${apiBase}/api/collaboration/rooms/${roomId}/requests`, {
    headers: headersFor('tokenA'),
  })).json();
  const requestToReject = refreshedQueue.requests.find((request) => request.user_id === 'user-c');
  const rejectResponse = await fetch(`${apiBase}/api/collaboration/rooms/${roomId}/requests/${requestToReject.id}`, {
    method: 'PATCH',
    headers: headersFor('tokenA'),
    body: JSON.stringify({ decision: 'rejected' }),
  });
  assert.equal(rejectResponse.status, 200);
  assert.equal((await (await fetch(`${apiBase}/api/collaboration/rooms/${roomId}/request`, {
    headers: headersFor('tokenC'),
  })).json()).status, 'rejected');
  assert.equal((await fetch(`${apiBase}/api/collaboration/rooms/${roomId}`, {
    headers: headersFor('tokenC'),
  })).status, 403);
});

test('teacher invitations grant read-only room-scoped teacher access and feedback', async (t) => {
  const { supabase } = createSupabaseMock();
  const app = express();
  app.use(express.json());
  app.use('/api/collaboration', createCollaborationRouter({ supabase }));
  const server = createServer(app);
  attachCollaborationWebSocket({ server, supabase, isAllowedOrigin: () => true });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const apiBase = `http://127.0.0.1:${server.address().port}`;
  const socketUrl = `ws://127.0.0.1:${server.address().port}/collaboration`;
  const headersFor = (token) => ({ authorization: `Bearer ${token}`, 'content-type': 'application/json' });
  const clients = [];
  t.after(async () => {
    await Promise.all(clients.map(closeClient));
    await new Promise((resolve) => server.close(resolve));
  });

  const createRoomResponse = await fetch(`${apiBase}/api/collaboration/rooms`, {
    method: 'POST', headers: headersFor('tokenA'), body: JSON.stringify({ language: 'python' }),
  });
  const created = await createRoomResponse.json();
  const roomId = created.room.publicId;
  const inviteResponse = await fetch(`${apiBase}/api/collaboration/rooms/${roomId}/teacher-invites`, {
    method: 'POST', headers: headersFor('tokenA'), body: JSON.stringify({}),
  });
  const teacherInvite = await inviteResponse.json();
  assert.equal(inviteResponse.status, 201);
  assert.equal(teacherInvite.inviteCode.length >= 20, true);

  const reusedResponse = await fetch(`${apiBase}/api/collaboration/rooms/${roomId}/teacher-invites`, {
    method: 'POST', headers: headersFor('tokenA'), body: JSON.stringify({ inviteCode: teacherInvite.inviteCode }),
  });
  assert.equal((await reusedResponse.json()).inviteCode, teacherInvite.inviteCode);
  const unrelatedRoomResponse = await fetch(`${apiBase}/api/collaboration/rooms`, {
    method: 'POST', headers: headersFor('tokenA'), body: JSON.stringify({ language: 'python' }),
  });
  const unrelatedRoom = await unrelatedRoomResponse.json();
  assert.equal((await fetch(`${apiBase}/api/collaboration/rooms/${unrelatedRoom.room.publicId}/teacher-invites/accept`, {
    method: 'POST', headers: headersFor('tokenC'), body: JSON.stringify({ inviteCode: teacherInvite.inviteCode }),
  })).status, 404);
  assert.equal((await fetch(`${apiBase}/api/collaboration/rooms/${roomId}/teacher-invites`, {
    method: 'POST', headers: headersFor('tokenB'), body: JSON.stringify({}),
  })).status, 403);

  const regularJoin = await fetch(`${apiBase}/api/collaboration/rooms/${roomId}/join`, {
    method: 'POST', headers: headersFor('tokenB'), body: JSON.stringify({ inviteCode: created.inviteCode }),
  });
  assert.equal(regularJoin.status, 200);
  assert.equal((await (await fetch(`${apiBase}/api/collaboration/rooms/${roomId}`, {
    headers: headersFor('tokenB'),
  })).json()).room.role, 'member');

  const acceptedResponse = await fetch(`${apiBase}/api/collaboration/rooms/${roomId}/teacher-invites/accept`, {
    method: 'POST', headers: headersFor('tokenB'), body: JSON.stringify({ inviteCode: teacherInvite.inviteCode }),
  });
  assert.equal(acceptedResponse.status, 200);
  assert.equal((await acceptedResponse.json()).room.role, 'teacher');
  assert.equal((await fetch(`${apiBase}/api/collaboration/rooms/${roomId}/teacher-invites/accept`, {
    method: 'POST', headers: headersFor('tokenC'), body: JSON.stringify({ inviteCode: teacherInvite.inviteCode }),
  })).status, 404);

  const feedbackResponse = await fetch(`${apiBase}/api/collaboration/rooms/${roomId}/feedback`, {
    method: 'POST', headers: headersFor('tokenB'), body: JSON.stringify({ message: 'Check the loop condition.', lineNumber: 3 }),
  });
  assert.equal(feedbackResponse.status, 201);
  assert.equal((await fetch(`${apiBase}/api/collaboration/rooms/${roomId}/feedback`, {
    method: 'POST', headers: headersFor('tokenC'), body: JSON.stringify({ message: 'Unauthorized feedback.' }),
  })).status, 403);
  const visibleFeedback = await (await fetch(`${apiBase}/api/collaboration/rooms/${roomId}/feedback`, {
    headers: headersFor('tokenA'),
  })).json();
  assert.equal(visibleFeedback.feedback[0].message, 'Check the loop condition.');

  const otherRoomResponse = await fetch(`${apiBase}/api/collaboration/rooms`, {
    method: 'POST', headers: headersFor('tokenA'), body: JSON.stringify({ language: 'python' }),
  });
  const otherRoom = await otherRoomResponse.json();
  const isolatedFeedback = await (await fetch(`${apiBase}/api/collaboration/rooms/${otherRoom.room.publicId}/feedback`, {
    headers: headersFor('tokenA'),
  })).json();
  assert.deepEqual(isolatedFeedback.feedback, []);

  const ownerClient = await connectClient(socketUrl, roomId, 'tokenA');
  const teacherClient = await connectClient(socketUrl, roomId, 'tokenB');
  clients.push(ownerClient, teacherClient);
  const participantUpdate = await waitForMessage(ownerClient, (message) => message.type === 'participants' && message.participants.length === 2, 'student and teacher participants');
  assert.deepEqual(participantUpdate.participants.map((participant) => participant.role).sort(), ['owner', 'teacher']);
  const vector = Y.encodeStateVector(teacherClient.document);
  teacherClient.document.getText('code').insert(0, 'teacher edit');
  teacherClient.socket.send(JSON.stringify({
    type: 'update',
    update: Buffer.from(Y.encodeStateAsUpdate(teacherClient.document, vector)).toString('base64'),
  }));
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(ownerClient.document.getText('code').toString(), '');
});

test('AI error correction is explicit, room-member scoped, and returns structured suggestions', async (t) => {
  const { supabase } = createSupabaseMock();
  const receivedContexts = [];
  const requestErrorCorrection = async (context) => {
    receivedContexts.push(context);
    return {
      diagnosis: 'A semicolon is missing.',
      errorLine: context.error.line,
      correction: 'Add a semicolon at the end of the statement.',
      correctedCode: `${context.code};`,
      explanation: 'This language requires a statement terminator.',
      changes: ['Added a semicolon.'],
      codeHash: 'current-code-hash',
    };
  };
  const app = express();
  app.use(express.json());
  app.use('/api/collaboration', createCollaborationRouter({ supabase, requestErrorCorrection }));
  const server = createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const apiBase = `http://127.0.0.1:${server.address().port}`;
  const headersFor = (token) => ({ authorization: `Bearer ${token}`, 'content-type': 'application/json' });
  const roomResponse = await fetch(`${apiBase}/api/collaboration/rooms`, {
    method: 'POST', headers: headersFor('tokenA'), body: JSON.stringify({ language: 'cpp' }),
  });
  const room = (await roomResponse.json()).room;
  const context = {
    language: 'cpp',
    code: 'std::cout << "hello"',
    error: { type: 'compile', message: "expected ';'", line: 4, column: 18 },
    problemContext: 'Print hello.',
  };

  const denied = await fetch(`${apiBase}/api/collaboration/rooms/${room.publicId}/error-correction`, {
    method: 'POST', headers: headersFor('tokenB'), body: JSON.stringify(context),
  });
  assert.equal(denied.status, 403);
  assert.equal(receivedContexts.length, 0);

  const response = await fetch(`${apiBase}/api/collaboration/rooms/${room.publicId}/error-correction`, {
    method: 'POST', headers: headersFor('tokenA'), body: JSON.stringify(context),
  });
  const suggestion = await response.json();
  assert.equal(response.status, 200);
  assert.equal(suggestion.diagnosis, 'A semicolon is missing.');
  assert.equal(suggestion.errorLine, 4);
  assert.equal(suggestion.correctedCode, `${context.code};`);
  assert.deepEqual(receivedContexts[0], context);

  const unavailableApp = express();
  unavailableApp.use(express.json());
  unavailableApp.use('/api/collaboration', createCollaborationRouter({ supabase }));
  const unavailableServer = createServer(unavailableApp);
  await new Promise((resolve) => unavailableServer.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => unavailableServer.close(resolve)));
  const unavailable = await fetch(`http://127.0.0.1:${unavailableServer.address().port}/api/collaboration/rooms/${room.publicId}/error-correction`, {
    method: 'POST', headers: headersFor('tokenA'), body: JSON.stringify(context),
  });
  assert.equal(unavailable.status, 503);
  assert.match((await unavailable.json()).error, /temporarily unavailable/i);
});

test('room creation surfaces a missing Supabase schema as an actionable backend error', async () => {
  const missingSchemaSupabase = {
    auth: {
      getUser: async (token) => usersByToken[token]
        ? { data: { user: usersByToken[token] }, error: null }
        : { data: { user: null }, error: new Error('Invalid token') },
    },
    from(table) {
      return {
        insert() {
          return {
            error: {
              code: '42P01',
              message: "Could not find the table 'public.collaboration_rooms' in the schema cache",
            },
          };
        },
        delete() {
          return { error: null };
        },
        select() { return { data: [], error: null }; },
        eq() { return this; },
        maybeSingle() { return { data: null, error: null }; },
        upsert() { return { data: null, error: null }; },
      };
    },
  };

  const app = express();
  app.use(express.json());
  app.use('/api/collaboration', createCollaborationRouter({ supabase: missingSchemaSupabase }));
  const server = createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const response = await fetch(`http://127.0.0.1:${address.port}/api/collaboration/rooms`, {
    method: 'POST',
    headers: { authorization: 'Bearer tokenA', 'content-type': 'application/json' },
    body: JSON.stringify({ language: 'python' }),
  });

  assert.equal(response.status, 503);
  const body = await response.json();
  assert.match(body.error, /frontend\/migrations\/20261001_teacher_assignments\.sql/i);
  await new Promise((resolve) => server.close(resolve));
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
  const otherRoom = await createRoom('tokenA');
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