import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyMentorIssue, codingMentorRequestSchema, generateCodingMentorResponse } from '../lib/codingMentor.mjs';

const parseJson = (raw) => JSON.parse(raw);
const validRequest = { language: 'python', code: 'print(1)', status: 'Accepted', statusId: 3 };
const aiResponse = {
  issue: 'The program stopped.',
  explanation: 'This error happened while the program was running.',
  hint: 'Inspect the value used on the reported line.',
  guidance: 'Review the operation and its inputs.',
  solution: 'print(1)',
  lineNumber: 2,
};

test('classifies syntax, runtime, logical, and successful execution distinctly', () => {
  assert.equal(classifyMentorIssue({ ...validRequest, statusId: 6, error: 'SyntaxError on line 2' }), 'syntax error');
  assert.equal(classifyMentorIssue({ ...validRequest, statusId: 11, error: 'IndexError' }), 'runtime error');
  assert.equal(classifyMentorIssue({ ...validRequest, statusId: 4, status: 'Wrong Answer' }), 'logical error');
  assert.equal(classifyMentorIssue(validRequest), 'no issue detected');
});

test('does not call the provider for empty code or unavailable execution', async () => {
  let calls = 0;
  const provider = async () => { calls += 1; return JSON.stringify(aiResponse); };
  const empty = await generateCodingMentorResponse({ language: 'python', code: '' }, provider, parseJson);
  const unavailable = await generateCodingMentorResponse({ ...validRequest, executionUnavailable: true }, provider, parseJson);
  assert.match(empty.issue, /no code/i);
  assert.match(unavailable.issue, /execution is unavailable/i);
  assert.equal(calls, 0);
});

test('uses a cautious local fallback when AI is unavailable or returns malformed data', async () => {
  const unavailable = await generateCodingMentorResponse(validRequest, async () => { throw new Error('offline'); }, parseJson);
  const malformed = await generateCodingMentorResponse(validRequest, async () => 'not JSON', parseJson);
  assert.equal(unavailable.source, 'fallback');
  assert.match(unavailable.notice, /temporarily unavailable/i);
  assert.equal(malformed.source, 'fallback');
  assert.match(malformed.notice, /unreadable/i);
});

test('keeps solution hidden except for an explicit solution action', async () => {
  const provider = async () => JSON.stringify(aiResponse);
  const explanation = await generateCodingMentorResponse(validRequest, provider, parseJson);
  const solution = await generateCodingMentorResponse({ ...validRequest, action: 'solution' }, provider, parseJson);
  assert.equal(explanation.solution, '');
  assert.match(explanation.notice, /unexpectedly/i);
  assert.equal(solution.solution, aiResponse.solution);
});

test('passes repeated hint count and previous attempts to the existing provider', async () => {
  let userMessage = '';
  const response = await generateCodingMentorResponse({
    ...validRequest,
    action: 'hint',
    hintCount: 3,
    previousAttempts: [{ issueType: 'runtime error', status: 'Runtime Error' }],
  }, async (messages) => {
    userMessage = messages[1].content;
    return JSON.stringify(aiResponse);
  }, parseJson);
  assert.equal(JSON.parse(userMessage).hintCount, 3);
  assert.equal(JSON.parse(userMessage).previousAttempts.length, 1);
  assert.equal(response.solution, '');
});

test('rejects malformed or oversized request context before provider use', () => {
  assert.equal(codingMentorRequestSchema.safeParse({ ...validRequest, code: 42 }).success, false);
  assert.equal(codingMentorRequestSchema.safeParse({ ...validRequest, unexpected: 'private data' }).success, false);
  assert.equal(codingMentorRequestSchema.safeParse({ ...validRequest, code: 'x'.repeat(12001) }).success, false);
});