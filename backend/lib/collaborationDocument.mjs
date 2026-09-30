import * as Y from 'yjs';

const MAX_UPDATE_BYTES = 1_000_000;

export const createCollaborationDocument = (code = '', language = 'python') => {
  const document = new Y.Doc();
  if (code) document.getText('code').insert(0, code);
  document.getMap('metadata').set('language', language);
  return document;
};

export const restoreCollaborationDocument = (encodedState) => {
  const document = new Y.Doc();
  if (encodedState) {
    const state = Buffer.from(encodedState, 'base64');
    if (state.byteLength > MAX_UPDATE_BYTES) throw new Error('Collaboration state is too large.');
    Y.applyUpdate(document, new Uint8Array(state));
  }
  return document;
};

export const applyCollaborationUpdate = (document, encodedUpdate, origin) => {
  if (typeof encodedUpdate !== 'string' || encodedUpdate.length > MAX_UPDATE_BYTES * 2) {
    throw new Error('Invalid collaboration update.');
  }
  const update = Buffer.from(encodedUpdate, 'base64');
  if (!update.byteLength || update.byteLength > MAX_UPDATE_BYTES) {
    throw new Error('Invalid collaboration update size.');
  }
  Y.applyUpdate(document, new Uint8Array(update), origin);
};

export const encodeCollaborationState = (document) =>
  Buffer.from(Y.encodeStateAsUpdate(document)).toString('base64');

export const encodeCollaborationUpdate = (update) => Buffer.from(update).toString('base64');