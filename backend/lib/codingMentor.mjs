import { z } from 'zod';

const issueTypes = [
  'syntax error',
  'runtime error',
  'logical error',
  'performance concern',
  'uncertain diagnosis',
  'no issue detected',
];

export const codingMentorRequestSchema = z.object({
  action: z.enum(['explain', 'hint', 'different', 'solution']).optional(),
  language: z.string().min(1).max(30),
  code: z.string().max(12000),
  error: z.string().max(4000).optional(),
  output: z.string().max(4000).optional(),
  status: z.string().max(200).optional(),
  statusId: z.number().int().min(0).max(20).optional(),
  problem: z.string().max(2000).optional(),
  executionUnavailable: z.boolean().optional(),
  hintCount: z.number().int().min(0).max(100).optional(),
  previousAttempts: z.array(z.object({
    issueType: z.enum(issueTypes),
    status: z.string().max(200),
  })).max(8).optional(),
}).strict();

const inferLineNumber = (diagnostic) => {
  const match = diagnostic.match(/\bline\s*[:#]?\s*(\d+)/i)
    || diagnostic.match(/(?:^|[\s("'`])[^:\r\n]+:(\d+)(?::\d+)?(?:\)|\s|$)/m);
  return match ? Number(match[1]) : null;
};

export const classifyMentorIssue = (request) => {
  if (!request.code.trim()) return 'uncertain diagnosis';
  const diagnostic = `${request.error || ''}\n${request.status || ''}\n${request.output || ''}`.toLowerCase();
  if (request.statusId === 5 || /time limit|timed out|execution time limit/.test(diagnostic)) return 'performance concern';
  if (request.statusId === 6 || /syntaxerror|syntax error|compilation error|compile error|invalid syntax|indentationerror|unexpected token/.test(diagnostic)) return 'syntax error';
  if ((request.statusId >= 7 && request.statusId <= 12)
    || /traceback|runtime error|exception|segmentation fault|referenceerror|nameerror|typeerror|zerodivisionerror|indexerror|nullpointer|panic:/.test(diagnostic)) return 'runtime error';
  if (request.statusId === 4 || /wrong answer/.test(diagnostic)) return 'logical error';
  if (request.statusId === 3 || /\baccepted\b/.test(diagnostic)) return 'no issue detected';
  return 'uncertain diagnosis';
};

const fallbackResponse = (request, issueType, notice) => {
  const diagnostic = `${request.error || ''}\n${request.output || ''}\n${request.status || ''}`;
  const lineNumber = inferLineNumber(diagnostic);
  if (request.executionUnavailable) {
    return {
      issueType: 'uncertain diagnosis',
      issue: 'Code execution is unavailable.',
      explanation: 'The runner could not be reached, so this result does not indicate a problem in your code.',
      hint: 'Check your connection and try running the code again.',
      guidance: 'Wait for the execution service to respond before changing code based on this result.',
      solution: '',
      lineNumber,
      source: 'fallback',
      notice,
    };
  }
  if (!request.code.trim()) {
    return {
      issueType: 'uncertain diagnosis',
      issue: 'There is no code to inspect yet.',
      explanation: 'Add a small amount of code and run it before asking for a diagnosis.',
      hint: 'Start with the smallest step that should produce a visible result.',
      guidance: 'Build the solution one piece at a time, running it after each change.',
      solution: '',
      lineNumber: null,
      source: 'fallback',
      notice,
    };
  }

  const messages = {
    'syntax error': ['The code could not be parsed.', 'A syntax error means the language rules were not met, so the program could not start.', 'Check the reported line and the one above it for a missing delimiter, unmatched bracket, or indentation mismatch.', 'Review the syntax rules for the construct around the reported line, then change one thing and run it again.'],
    'runtime error': ['The program stopped while running.', 'A runtime error happens after parsing when an operation cannot complete with the values or state available.', 'Start with the last application line in the traceback and inspect the values used there.', 'Review that operation’s inputs, types, and boundary cases.'],
    'logical error': ['The output did not match the expected result.', 'The program ran, but its behavior does not match the expected result. This points toward the algorithm or a missed case, rather than syntax.', 'Trace one small input by hand and compare each intermediate value with the expected behavior.', 'Review the condition, loop bounds, and how the result is updated for that example.'],
    'performance concern': ['The run exceeded its time limit.', 'The program did not finish within the runner’s time limit. Repeated work or an algorithm that grows quickly may be involved.', 'Estimate how many times the main loop or function runs as the input grows.', 'Review the algorithm’s time complexity and look for repeated scans or nested work.'],
    'no issue detected': ['The code ran without a reported error.', 'Execution completed without a reported error. A successful run alone does not prove the logic is correct for every input.', 'Try a boundary case, such as the smallest allowed input or a value at a constraint limit.', 'Compare the actual output with expected behavior on a few representative inputs.'],
    'uncertain diagnosis': ['There is not enough evidence to identify the cause.', 'The execution result does not clearly identify a syntax, runtime, logic, or performance problem. I do not want to guess.', 'Add the expected behavior or a failing input, then compare it with the actual output.', 'Check the runner status and provide a short problem description or the input that produced this result.'],
  }[issueType];

  return {
    issueType,
    issue: messages[0],
    explanation: messages[1],
    hint: messages[2],
    guidance: messages[3],
    solution: '',
    lineNumber,
    source: 'fallback',
    notice,
  };
};

const safeText = (value, maxLength) => typeof value === 'string' ? value.trim().slice(0, maxLength) : '';

export const generateCodingMentorResponse = async (request, callLLM, parseJsonLoose) => {
  const issueType = classifyMentorIssue(request);
  if (request.executionUnavailable || !request.code.trim()) {
    return fallbackResponse(request, issueType);
  }

  const action = request.action || 'explain';
  const context = {
    language: request.language,
    code: request.code,
    issueType,
    error: request.error || '',
    output: request.output || '',
    status: request.status || '',
    statusId: request.statusId,
    problem: request.problem || '',
    hintCount: request.hintCount || 0,
    previousAttempts: request.previousAttempts || [],
    action,
  };
  let raw;
  try {
    raw = await callLLM([
      {
        role: 'system',
        content: `You are a patient coding tutor for beginners. Return strict JSON with string fields issue, explanation, hint, guidance, solution, and nullable integer lineNumber. Use simple, encouraging language and never make claims unsupported by the provided execution evidence. Preserve the detected issue category: ${issueType}. Explain the concept and give a clue without writing replacement code. Only include a complete working solution when action is "solution"; for all other actions solution must be an empty string. For hint, provide a new clue that builds on the prior hint count. For different, explain the same diagnosis using a different analogy or simpler wording. If the evidence is insufficient, say so clearly.`,
      },
      { role: 'user', content: JSON.stringify(context) },
    ]);
  } catch {
    return fallbackResponse(request, issueType, 'AI Mentor is temporarily unavailable. Showing a local explanation instead.');
  }

  let parsed;
  try {
    parsed = parseJsonLoose(raw);
  } catch {
    parsed = null;
  }
  if (!parsed || typeof parsed !== 'object') {
    return fallbackResponse(request, issueType, 'AI Mentor returned an unreadable response. Showing a local explanation instead.');
  }

  const solution = request.action === 'solution' ? safeText(parsed.solution, 6000) : '';
  const leakedCode = request.action !== 'solution'
    && (safeText(parsed.solution, 6000)
      || ['issue', 'explanation', 'hint', 'guidance'].some((key) => /```/.test(safeText(parsed[key], 2000))));
  if (leakedCode) {
    return fallbackResponse(request, issueType, 'AI returned a complete solution unexpectedly. Showing hint-only guidance instead.');
  }
  if (request.action === 'solution' && !solution) {
    return fallbackResponse(request, issueType, 'A complete solution was not returned. You can still work through the hints.');
  }
  return {
    issueType,
    issue: safeText(parsed.issue, 500) || 'Execution feedback is available.',
    explanation: safeText(parsed.explanation, 2000),
    hint: safeText(parsed.hint, 1200),
    guidance: safeText(parsed.guidance, 1200),
    solution,
    lineNumber: Number.isInteger(parsed.lineNumber) && parsed.lineNumber > 0 ? parsed.lineNumber : inferLineNumber(`${request.error || ''}\n${request.output || ''}`),
    source: 'ai',
  };
};