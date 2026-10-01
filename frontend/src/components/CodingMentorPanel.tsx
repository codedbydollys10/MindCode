import { useCallback, useEffect, useRef, useState } from "react";
import { BookOpen, Lightbulb, Loader2, MessageCircle, WandSparkles } from "lucide-react";
import {
  classifyCodingIssue,
  readCodingMentorEventCounts,
  recordCodingMentorEvent,
  requestCodingMentor,
  type CodingMentorAction,
  type CodingMentorEventCounts,
  type CodingMentorIssueType,
  type CodingMentorResponse,
} from "@/lib/codingMentor";

export type CodingMentorRun = {
  id: number;
  language: string;
  code: string;
  error?: string;
  output?: string;
  status?: string;
  statusId?: number;
  executionUnavailable?: boolean;
};

type Props = {
  apiBase: string;
  roomId: string;
  run: CodingMentorRun | null;
};

const issueLabel: Record<CodingMentorIssueType, string> = {
  "syntax error": "Syntax error",
  "runtime error": "Runtime error",
  "logical error": "Logical error",
  "performance concern": "Performance concern",
  "uncertain diagnosis": "Uncertain diagnosis",
  "no issue detected": "No issue detected",
};

export default function CodingMentorPanel({ apiBase, roomId, run }: Props) {
  const [response, setResponse] = useState<CodingMentorResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [hintCount, setHintCount] = useState(0);
  const [events, setEvents] = useState<CodingMentorEventCounts>(() => readCodingMentorEventCounts(roomId));
  const previousAttemptsRef = useRef<Array<{ issueType: CodingMentorIssueType; status: string }>>([]);
  const controllerRef = useRef<AbortController | null>(null);
  const hintCountRef = useRef(0);

  const updateEvent = useCallback((eventType: keyof CodingMentorEventCounts) => {
    recordCodingMentorEvent(roomId, eventType);
    setEvents(readCodingMentorEventCounts(roomId));
  }, [roomId]);

  const request = useCallback(async (action: CodingMentorAction, requestedHintCount = hintCountRef.current) => {
    if (!run) return;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setLoading(true);
    const result = await requestCodingMentor(apiBase, {
      action,
      language: run.language,
      code: run.code,
      error: run.error,
      output: run.output,
      status: run.status,
      statusId: run.statusId,
      executionUnavailable: run.executionUnavailable,
      hintCount: requestedHintCount,
      previousAttempts: previousAttemptsRef.current,
    }, controller.signal);
    if (!controller.signal.aborted) {
      setResponse(result);
      setLoading(false);
    }
  }, [apiBase, run]);

  useEffect(() => {
    if (!run) return;
    const classification = classifyCodingIssue({
      language: run.language,
      code: run.code,
      error: run.error,
      output: run.output,
      status: run.status,
      statusId: run.statusId,
      executionUnavailable: run.executionUnavailable,
    });
    if (["syntax error", "runtime error", "logical error", "performance concern"].includes(classification)) {
      updateEvent("error_encountered");
      previousAttemptsRef.current = [
        ...previousAttemptsRef.current,
        { issueType: classification, status: run.status || run.error || "Execution failed" },
      ].slice(-8);
    } else if (classification === "no issue detected" && previousAttemptsRef.current.length > 0) {
      updateEvent("successful_correction");
      previousAttemptsRef.current = [];
    }
    setResponse(null);
    void request("explain", hintCountRef.current);
    return () => controllerRef.current?.abort();
  }, [request, run, updateEvent]);

  useEffect(() => () => controllerRef.current?.abort(), []);

  const handleHint = () => {
    const nextCount = hintCountRef.current + 1;
    hintCountRef.current = nextCount;
    setHintCount(nextCount);
    updateEvent("hint_requested");
    void request("hint", nextCount);
  };

  const handleSolution = () => {
    updateEvent("solution_requested");
    void request("solution");
  };

  return (
    <section aria-label="AI Coding Mentor" className="border-t border-border bg-bg-surface px-3 py-3">
      <header className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <WandSparkles className="h-4 w-4 text-teal" /> AI Coding Mentor
        </h2>
        <span className="text-[11px] text-muted-foreground">Hints {hintCount} · {events.error_encountered} issues</span>
      </header>
      {!run && <p className="mt-2 text-xs text-muted-foreground">Run your code to get an explanation and a hint.</p>}
      {loading && <p role="status" className="mt-2 flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Reviewing this run…</p>}
      {response && (
        <div className="mt-3 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold text-foreground">{issueLabel[response.issueType]}</p>
              <p className="mt-1 text-xs text-muted-foreground">{response.issue}{response.lineNumber ? ` · Line ${response.lineNumber}` : ""}</p>
            </div>
            {response.source !== "ai" && <span className="shrink-0 text-[10px] text-muted-foreground">Local guidance</span>}
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <div className="min-w-0">
              <p className="flex items-center gap-1 text-[11px] font-semibold text-foreground"><MessageCircle className="h-3 w-3 text-teal" /> Explanation</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{response.explanation}</p>
            </div>
            <div className="min-w-0">
              <p className="flex items-center gap-1 text-[11px] font-semibold text-foreground"><Lightbulb className="h-3 w-3 text-gold" /> Hint</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{response.hint}</p>
            </div>
            <div className="min-w-0">
              <p className="flex items-center gap-1 text-[11px] font-semibold text-foreground"><BookOpen className="h-3 w-3 text-ice" /> Guided debugging</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{response.guidance}</p>
            </div>
          </div>
          {response.notice && <p role="status" className="text-[11px] text-gold">{response.notice}</p>}
          {response.solution && <pre className="max-h-48 overflow-auto rounded-md border border-border bg-background p-3 font-mono text-xs whitespace-pre-wrap">{response.solution}</pre>}
          {!run.executionUnavailable && run.code.trim() && (
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={handleHint} disabled={loading} className="rounded-md border border-border px-2.5 py-1.5 text-xs text-foreground hover:bg-bg-hover disabled:opacity-50">Give me another hint</button>
              <button type="button" onClick={() => void request("different")} disabled={loading} className="rounded-md border border-border px-2.5 py-1.5 text-xs text-foreground hover:bg-bg-hover disabled:opacity-50">Explain differently</button>
              {!response.solution && <button type="button" onClick={handleSolution} disabled={loading} className="rounded-md border border-border px-2.5 py-1.5 text-xs text-foreground hover:bg-bg-hover disabled:opacity-50">Show solution</button>}
            </div>
          )}
        </div>
      )}
    </section>
  );
}