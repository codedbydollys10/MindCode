import assert from 'node:assert/strict';
import test from 'node:test';
import * as Y from 'yjs';
import {
  applyCollaborationUpdate,
  createCollaborationDocument,
  encodeCollaborationState,
  encodeCollaborationUpdate,
  restoreCollaborationDocument,
} from '../lib/collaborationDocument.mjs';

test('concurrent edits converge after exchanging Yjs updates', () => {
  const initial = createCollaborationDocument('base');
  const initialState = encodeCollaborationState(initial);
  const userA = restoreCollaborationDocument(initialState);
  const userB = restoreCollaborationDocument(initialState);
  const stateVectorA = Y.encodeStateVector(userA);
  const stateVectorB = Y.encodeStateVector(userB);

  userA.getText('code').insert(2, ' from A');
  userB.getText('code').insert(2, ' from B');

  const updateA = Y.encodeStateAsUpdate(userA, stateVectorB);
  const updateB = Y.encodeStateAsUpdate(userB, stateVectorA);
  applyCollaborationUpdate(userA, encodeCollaborationUpdate(updateB), 'remote');
  applyCollaborationUpdate(userB, encodeCollaborationUpdate(updateA), 'remote');

  assert.equal(userA.getText('code').toString(), userB.getText('code').toString());
  assert.match(userA.getText('code').toString(), /from A/);
  assert.match(userA.getText('code').toString(), /from B/);
});

test('updates applied in one room do not mutate another room document', () => {
  const roomA = createCollaborationDocument('room A');
  const roomB = createCollaborationDocument('room B');
  const roomAInitialState = Y.encodeStateVector(roomA);

  roomA.getText('code').insert(roomA.getText('code').length, ' update');
  const update = Y.encodeStateAsUpdate(roomA, roomAInitialState);
  applyCollaborationUpdate(roomA, encodeCollaborationUpdate(update), 'echo');

  assert.equal(roomA.getText('code').toString(), 'room A update');
  assert.equal(roomB.getText('code').toString(), 'room B');
});