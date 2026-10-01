export type CodingMentorIssueType =
  | "syntax error"
  | "runtime error"
  | "logical error"
  | "performance concern"
  | "uncertain diagnosis"
  | "no issue detected";

export type CodingMentorAction = "explain" | "hint" | "different" | "solution";

export type CodingMentorRequest = {
  action?: CodingMentorAction;
  language: string;
  code: string;
  error?: string;
  output?: string;
  status?: string;
  statusId?: number;
  problem?: string;
  executionUnavailable?: boolean;
  hintCount?: number;
  previousAttempts?: Array<{ issueType: CodingMentorIssueType; status: string }>;
};

export type CodingMentorResponse = {
  issueType: CodingMentorIssueType;
  issue: string;
  explanation: string;
  hint: string;
  guidance: string;
  solution: string;
  lineNumber?: number | null;
  source: "ai" | "fallback" | "client-fallback";
  notice?: string;
};

export type CodingMentorEventType =
  | "error_encountered"
  | "hint_requested"
  | "solution_requested"
  | "successful_correction";

export type CodingMentorEventCounts = Record<CodingMentorEventType, number>;

const eventTypes: CodingMentorEventType[] = [
  "error_encountered",
  "hint_requested",
  "solution_requested",
  "successful_correction",
];

const issueTypes: CodingMentorIssueType[] = [
  "syntax error",
  "runtime error",
  "logical error",
  "performance concern",
  "uncertain diagnosis",
  "no issue detected",
];

const emptyEventCounts = (): CodingMentorEventCounts => ({
  error_encountered: 0,
  hint_requested: 0,
  solution_requested: 0,
  successful_correction: 0,
});

const eventStorageKey = (roomId: string) => `mindcode:mentor-events:${roomId}`;

export const recordCodingMentorEvent = (roomId: string, eventType: CodingMentorEventType) => {
  if (!roomId || !eventTypes.includes(eventType) || typeof window === "undefined") return;
  try {
    const stored = window.localStorage.getItem(eventStorageKey(roomId));
    const previous = stored ? JSON.parse(stored) as Partial<CodingMentorEventCounts> : {};
    const counts = emptyEventCounts();
    for (const key of eventTypes) {
      const value = Number(previous[key]);
      counts[key] = Number.isSafeInteger(value) && value > 0 ? value : 0;
    }
    counts[eventType] += 1;
    window.localStorage.setItem(eventStorageKey(roomId), JSON.stringify(counts));
  } catch {
    // Local event recording is best-effort and never blocks mentoring.
  }
};

export const readCodingMentorEventCounts = (roomId: string): CodingMentorEventCounts => {
  if (!roomId || typeof window === "undefined") return emptyEventCounts();
  try {
    const stored = window.localStorage.getItem(eventStorageKey(roomId));
    if (!stored) return emptyEventCounts();
    const parsed = JSON.parse(stored) as Partial<CodingMentorEventCounts>;
    const counts = emptyEventCounts();
    for (const key of eventTypes) {
      const value = Number(parsed[key]);
      counts[key] = Number.isSafeInteger(value) && value > 0 ? value : 0;
    }
    return counts;
  } catch {
    return emptyEventCounts();
  }
};

const inferLineNumber = (diagnostic: string) => {
  const lineMatch = diagnostic.match(/\bline\s*[:#]?\s*(\d+)/i)
    || diagnostic.match(/(?:^|[\s("'`])[^:\r\n]+:(\d+)(?::\d+)?(?:\)|\s|$)/m);
  return lineMatch ? Number(lineMatch[1]) : null;
};

export const classifyCodingIssue = (request: CodingMentorRequest): CodingMentorIssueType => {
  if (!request.code.trim()) return "uncertain diagnosis";
  const diagnostic = `${request.error || ""}\n${request.status || ""}\n${request.output || ""}`.toLowerCase();
  if (request.statusId === 5 || /time limit|timed out|execution time limit/.test(diagnostic)) return "performance concern";
  if (request.statusId === 6 || /syntaxerror|syntax error|compilation error|compile error|invalid syntax|indentationerror|unexpected token/.test(diagnostic)) return "syntax error";
  if ((request.statusId !== undefined && request.statusId >= 7 && request.statusId <= 12)
    || /traceback|runtime error|exception|segmentation fault|referenceerror|nameerror|typeerror|zerodivisionerror|indexerror|nullpointer|panic:/.test(diagnostic)) return "runtime error";
  if (request.statusId === 4 || /wrong answer/.test(diagnostic)) return "logical error";
  if (request.statusId === 3 || /\baccepted\b/.test(diagnostic)) {
    return request.problem?.trim() ? "uncertain diagnosis" : "no issue detected";
  }
  return "uncertain diagnosis";
};

const fallbackResponse = (request: CodingMentorRequest, source: CodingMentorResponse["source"], notice?: string): CodingMentorResponse => {
  const diagnostic = `${request.error || ""}\n${request.output || ""}\n${request.status || ""}`;
  const issueType = request.executionUnavailable ? "uncertain diagnosis" : classifyCodingIssue(request);
  const lineNumber = inferLineNumber(diagnostic);
  if (request.executionUnavailable) {
    return {
      issueType,
      issue: "Code execution is unavailable.",
      explanation: "The runner could not be reached, so this is a service connection problem rather than evidence of a code error.",
      hint: "Check your connection and try running the code again.",
      guidance: "Wait for the execution service to respond before changing code based on this result.",
      solution: "",
      lineNumber,
      source,
      notice,
    };
  }
  if (!request.code.trim()) {
    return {
      issueType,
      issue: "There is no code to inspect yet.",
      explanation: "Add a small amount of code and run it before asking for a diagnosis.",
      hint: "Start with the smallest step that should produce a visible result.",
      guidance: "Build the solution one piece at a time, running it after each change.",
      solution: "",
      lineNumber,
      source,
      notice,
    };
  }
  const content: Record<CodingMentorIssueType, Omit<CodingMentorResponse, "issueType" | "source" | "notice" | "lineNumber">> = {
    "syntax error": {
      issue: "The code could not be parsed.",
      explanation: "A syntax error means the language rules were not met, so the program could not start. The reported line is often where the parser got confused, but the typo may be just before it.",
      hint: "Check the reported line and the one above it for a missing delimiter, unmatched bracket, or indentation mismatch.",
      guidance: "Review the syntax rules for the construct around the reported line, then change one thing and run it again.",
      solution: "",
    },
    "runtime error": {
      issue: "The program started but stopped while running.",
      explanation: "A runtime error happens after parsing. An operation could not complete with the values or state available at that point.",
      hint: "Start with the last application line in the traceback and inspect the values used there.",
      guidance: "Review that operation’s input, type, and boundary cases. Trace one small example up to the failing line.",
      solution: "",
    },
    "logical error": {
      issue: "The output did not match the expected result.",
      explanation: "The program ran, but its behavior appears not to match the expected result. This points toward the algorithm or a missed case, rather than syntax.",
      hint: "Trace one small input by hand and compare each intermediate value with the expected behavior.",
      guidance: "Review the condition, loop bounds, and how the result is updated for that example.",
      solution: "",
    },
    "performance concern": {
      issue: "The run exceeded its time limit.",
      explanation: "The program did not finish within the runner’s time limit. Repeated work or an algorithm that grows quickly may be involved.",
      hint: "Estimate how many times the main loop or function runs as the input grows.",
      guidance: "Review the algorithm’s time complexity and look for repeated scans or nested work.",
      solution: "",
    },
    "no issue detected": {
      issue: "The code ran without a reported error.",
      explanation: "The execution completed without a reported error. A successful run alone does not prove the logic is correct for every input.",
      hint: "Try a boundary case, such as the smallest allowed input or a value at a constraint limit.",
      guidance: "Compare the actual output with the expected behavior on a few representative inputs.",
      solution: "",
    },
    "uncertain diagnosis": {
      issue: "There is not enough evidence to identify the cause.",
      explanation: "The execution result does not clearly identify a syntax, runtime, logic, or performance problem. I do not want to guess.",
      hint: "Add the expected behavior or a failing input, then compare it with the actual output.",
      guidance: "Check the runner status and provide a short problem description or the input that produced this result.",
      solution: "",
    },
  };
  return { ...content[issueType], issueType, lineNumber, source, notice };
};

const isMentorResponse = (value: unknown): value is CodingMentorResponse => {
  if (!value || typeof value !== "object") return false;
  const response = value as Partial<CodingMentorResponse>;
  return Boolean(
    response.issueType && issueTypes.includes(response.issueType)
    && typeof response.issue === "string"
    && typeof response.explanation === "string"
    && typeof response.hint === "string"
    && typeof response.guidance === "string"
    && typeof response.solution === "string",
  );
};

export const requestCodingMentor = async (
  apiBase: string,
  request: CodingMentorRequest,
  signal?: AbortSignal,
): Promise<CodingMentorResponse> => {
  if (request.executionUnavailable || !request.code.trim()) return fallbackResponse(request, "fallback");
  try {
    const response = await fetch(`${apiBase}/mentor`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal,
    });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok || !isMentorResponse(body)) throw new Error("Mentor response was unavailable.");
    const result = body;
    if (request.action !== "solution") {
      if (result.solution.trim() || [result.issue, result.explanation, result.hint, result.guidance].some((text) => /```/.test(text))) {
        throw new Error("Mentor returned an unsolicited solution.");
      }
      result.solution = "";
    }
    if (request.action === "solution" && !result.solution.trim()) {
      return fallbackResponse(request, "fallback", "A complete solution was not returned. You can still work through the hints.");
    }
    return result;
  } catch {
    return fallbackResponse(request, "client-fallback", "AI Mentor is temporarily unavailable. Showing a local explanation instead.");
  }
};