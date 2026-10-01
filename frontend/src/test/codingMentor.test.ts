import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  classifyCodingIssue,
  readCodingMentorEventCounts,
  recordCodingMentorEvent,
  requestCodingMentor,
  type CodingMentorRequest,
  type CodingMentorResponse,
} from "@/lib/codingMentor";

const baseRequest: CodingMentorRequest = {
  language: "python",
  code: "print(value)",
};

const responseBody: CodingMentorResponse = {
  issueType: "runtime error",
  issue: "The program stopped while running.",
  explanation: "The name is not available at this point in the program.",
  hint: "Check where this name is created.",
  guidance: "Review variable scope and spelling.",
  solution: "print(1)",
  lineNumber: 2,
  source: "ai",
};

describe("AI Coding Mentor", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("distinguishes syntax, runtime, and logical errors", () => {
    expect(classifyCodingIssue({ ...baseRequest, error: "SyntaxError on line 2" })).toBe("syntax error");
    expect(classifyCodingIssue({ ...baseRequest, error: "Traceback: NameError" })).toBe("runtime error");
    expect(classifyCodingIssue({ ...baseRequest, status: "Wrong Answer", statusId: 4 })).toBe("logical error");
  });

  it("recognizes valid code without claiming the logic is proven", () => {
    expect(classifyCodingIssue({ ...baseRequest, status: "Accepted", statusId: 3 })).toBe("no issue detected");
  });

  it("handles empty code locally without contacting the provider", async () => {
    const result = await requestCodingMentor("/api", { ...baseRequest, code: "" });
    expect(result.issue).toMatch(/no code/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falls back safely when the provider response is malformed", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ issueType: "made up" }) });
    const result = await requestCodingMentor("/api", baseRequest);
    expect(result.source).toBe("client-fallback");
    expect(result.issueType).toBe("uncertain diagnosis");
  });

  it("provides a local explanation when AI is unavailable", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    const result = await requestCodingMentor("/api", baseRequest);
    expect(result.notice).toMatch(/temporarily unavailable/i);
    expect(result.solution).toBe("");
  });

  it("does not ask AI to diagnose an unavailable execution service", async () => {
    const result = await requestCodingMentor("/api", { ...baseRequest, executionUnavailable: true });
    expect(result.issue).toMatch(/execution is unavailable/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("increments and forwards repeated hint requests", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ...responseBody, solution: "" }) });
    await requestCodingMentor("/api", { ...baseRequest, action: "hint", hintCount: 1 });
    await requestCodingMentor("/api", { ...baseRequest, action: "hint", hintCount: 2 });
    const first = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    const second = JSON.parse(fetchMock.mock.calls[1][1].body as string);
    expect(first.hintCount).toBe(1);
    expect(second.hintCount).toBe(2);
    recordCodingMentorEvent("room-1", "hint_requested");
    recordCodingMentorEvent("room-1", "hint_requested");
    expect(readCodingMentorEventCounts("room-1").hint_requested).toBe(2);
  });

  it("withholds the complete solution until explicitly requested", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => responseBody });
    const explanation = await requestCodingMentor("/api", baseRequest);
    const requested = await requestCodingMentor("/api", { ...baseRequest, action: "solution" });
    expect(explanation.solution).toBe("");
    expect(requested.solution).toBe(responseBody.solution);
  });

  it("falls back to hints if AI leaks a solution before being asked", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => responseBody });
    const result = await requestCodingMentor("/api", baseRequest);
    expect(result.source).toBe("client-fallback");
    expect(result.solution).toBe("");
    expect(result.notice).toMatch(/temporarily unavailable/i);
  });
});