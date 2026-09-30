import { useEffect, useRef } from "react";

const WS_URL = (() => {
  const base = import.meta.env.VITE_WS_URL as string | undefined;
  if (base) return base;
  const httpBase = (import.meta.env.VITE_CODE_RUNNER_URL as string | undefined) || "https://mind-code-gilt.vercel.app";
  return `${httpBase.replace(/^http/, "ws")}/stream`;
})();

const API_BASE = (import.meta.env.VITE_CODE_RUNNER_URL as string | undefined) || "https://mind-code-gilt.vercel.app";
const FLUSH_INTERVAL_MS = 800;
const SNAPSHOT_INTERVAL_MS = 15000;
const SNAPSHOT_DELTA_CHARS = 100;

type MonacoEditorLike = {
  getPosition?: () => { lineNumber: number; column: number } | null;
  getModel?: () => any;
  getValue?: () => string;
  onKeyDown?: (cb: (e: any) => void) => { dispose?: () => void };
  onDidType?: (cb: (text: string) => void) => { dispose?: () => void };
  onDidChangeCursorPosition?: (cb: (e: any) => void) => { dispose?: () => void };
  onDidChangeModelContent?: (cb: (e: any) => void) => { dispose?: () => void };
};

export type KeystrokeCtx = {
  userId: string | null;
  sessionId: string;
  problemId?: string;
};

type KeystrokeEvent = {
  user_id: string;
  test_id: string;
  timestamp: string;
  typing_speed?: number;
  typing_speed_avg?: number;
  pause_duration?: number;
  pause_duration_ms?: number;
  backspace_count?: number;
  cursor_position?: number | null;
  code_snapshot?: string;
  line_number?: number | null;
  action_type?: "insert" | "delete" | "paste" | "navigate" | "idle";
  code_length?: number;
  line_time_ms?: number;
  idle_time_ms?: number;
  idle_ms?: number;
  error_count?: number;
  is_paste_event?: boolean;
  paste_line_count?: number;
  paste_char_count?: number;
  burst_insert_detected?: boolean;
  word_count?: number;
  paste_detected?: boolean;
  pasted_line_count?: number;
  pasted_char_count?: number;
  sudden_code_jump?: boolean;
  prev_line_number?: number | null;
  key_pressed?: string;
  keystroke_count?: number;
  hesitation_count?: number;
  error_recovery_time_ms?: number | null;
  line_rewrites?: number;
  code_rewrite_count?: number;
  deletion_bursts?: number;
  block_duration_ms?: number;
  focus_level?: number;
  is_completing?: boolean;
  problem_id?: string;
};

export function useKeystrokeTracker(editorRef: { current: MonacoEditorLike | null }, ctx: KeystrokeCtx) {
  const wsRef = useRef<WebSocket | null>(null);
  const bufferRef = useRef<KeystrokeEvent[]>([]);
  const flushTimerRef = useRef<number | null>(null);
  const lastEventAtRef = useRef<number>(Date.now());
  const lastKeyDownAtRef = useRef<number>(0);
  const sessionStartRef = useRef<number>(Date.now());

  const lastLineRef = useRef<number | null>(null);
  const lineEnteredAtRef = useRef<number>(Date.now());
  const linesMovedAwayRef = useRef<Set<number>>(new Set());

  const lastCodeLengthRef = useRef<number>(0);
  const lastCodeChangeAtRef = useRef<number>(0);
  const lastSnapshotAtRef = useRef<number>(0);
  const lastSnapshotCodeLengthRef = useRef<number>(0);
  const blockStartAtRef = useRef<number>(Date.now());

  const pendingPasteRef = useRef<boolean>(false);
  const pendingPasteAtRef = useRef<number>(0);

  const totalKeystrokesRef = useRef<number>(0);
  const totalTypedCharsRef = useRef<number>(0);
  const totalIdleMsRef = useRef<number>(0);

  const rollingTypedCharsRef = useRef<Array<{ ts: number; count: number }>>([]);
  const backspaceStreakRef = useRef<number>(0);

  const errorCountRef = useRef<number>(0);
  const errorIncreasedAtRef = useRef<number | null>(null);

  const lastIdleEmissionRef = useRef<number>(0);

  const pushEvent = (partial: Partial<KeystrokeEvent>) => {
    if (!ctx.userId || !ctx.sessionId) return;

    const now = Date.now();
    const editor = editorRef.current;
    const code = editor?.getValue?.() || "";
    const position = editor?.getPosition?.() || null;
    const lineNumber = position?.lineNumber ?? null;
    const prevLineNumber = lastLineRef.current;
    const pauseMs = lastEventAtRef.current ? Math.max(0, now - lastEventAtRef.current) : 0;
    lastEventAtRef.current = now;

    const totalElapsedMs = Math.max(1, now - sessionStartRef.current);
    const focusLevel = Math.max(0, Math.min(1, 1 - (totalIdleMsRef.current / totalElapsedMs)));

    const typedWindow = rollingTypedCharsRef.current.filter((entry) => now - entry.ts <= 3000);
    rollingTypedCharsRef.current = typedWindow;
    const charsIn3s = typedWindow.reduce((acc, item) => acc + item.count, 0);
    const typingSpeed = charsIn3s / 3;
    const typingSpeedAvg = totalTypedCharsRef.current / (totalElapsedMs / 1000);

    const lineTimeMs = Math.max(0, now - lineEnteredAtRef.current);

    const codeLength = code.length;
    const wordCount = code.trim().length ? code.trim().split(/\s+/).length : 0;

    const suddenCodeJump =
      typeof lineNumber === "number" &&
      typeof prevLineNumber === "number" &&
      Math.abs(lineNumber - prevLineNumber) > 20;

    const shouldSnapshot =
      Math.abs(codeLength - lastSnapshotCodeLengthRef.current) > SNAPSHOT_DELTA_CHARS ||
      now - lastSnapshotAtRef.current >= SNAPSHOT_INTERVAL_MS;

    const codeSnapshot = partial.code_snapshot ?? (shouldSnapshot ? code : undefined);
    if (codeSnapshot !== undefined) {
      lastSnapshotAtRef.current = now;
      lastSnapshotCodeLengthRef.current = codeLength;
    }

    const action = partial.action_type || "insert";

    const event: KeystrokeEvent = {
      user_id: ctx.userId,
      test_id: ctx.sessionId,
      problem_id: ctx.problemId,
      timestamp: new Date(now).toISOString(),
      action_type: action,
      key_pressed: partial.key_pressed,
      typing_speed: Number.isFinite(typingSpeed) ? Number(typingSpeed.toFixed(3)) : 0,
      typing_speed_avg: Number.isFinite(typingSpeedAvg) ? Number(typingSpeedAvg.toFixed(3)) : 0,
      pause_duration: pauseMs,
      pause_duration_ms: pauseMs,
      backspace_count: partial.backspace_count ?? 0,
      cursor_position: position?.column ?? null,
      line_number: lineNumber,
      prev_line_number: prevLineNumber,
      line_time_ms: lineTimeMs,
      code_length: codeLength,
      word_count: wordCount,
      code_snapshot: codeSnapshot,
      idle_time_ms: partial.idle_ms ?? partial.idle_time_ms ?? 0,
      idle_ms: partial.idle_ms ?? partial.idle_time_ms ?? 0,
      error_count: partial.error_count ?? errorCountRef.current,
      is_paste_event: Boolean(partial.is_paste_event),
      paste_detected: Boolean(partial.paste_detected),
      paste_line_count: partial.paste_line_count ?? partial.pasted_line_count ?? 0,
      paste_char_count: partial.paste_char_count ?? partial.pasted_char_count ?? 0,
      pasted_line_count: partial.pasted_line_count ?? partial.paste_line_count ?? 0,
      pasted_char_count: partial.pasted_char_count ?? partial.paste_char_count ?? 0,
      burst_insert_detected: Boolean(partial.burst_insert_detected),
      sudden_code_jump: Boolean(partial.sudden_code_jump ?? suddenCodeJump),
      keystroke_count: partial.keystroke_count ?? totalKeystrokesRef.current,
      hesitation_count: partial.hesitation_count ?? 0,
      error_recovery_time_ms: partial.error_recovery_time_ms ?? null,
      line_rewrites: partial.line_rewrites ?? 0,
      code_rewrite_count: partial.code_rewrite_count ?? 0,
      deletion_bursts: partial.deletion_bursts ?? 0,
      block_duration_ms: partial.block_duration_ms ?? 0,
      focus_level: Number(focusLevel.toFixed(4)),
      is_completing: Boolean(partial.is_completing),
    };

    bufferRef.current.push(event);
  };

  const flushBuffer = async () => {
    if (!bufferRef.current.length || !ctx.userId || !ctx.sessionId) return;

    const events = bufferRef.current.splice(0, bufferRef.current.length);
    const ws = wsRef.current;

    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "keystroke-batch", data: { events } }));
      return;
    }

    try {
      await fetch(`${API_BASE}/log-keystrokes-batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ events }),
      });
    } catch {
      bufferRef.current.unshift(...events);
      if (bufferRef.current.length > 2000) {
        bufferRef.current.splice(0, bufferRef.current.length - 2000);
      }
    }
  };

  useEffect(() => {
    if (!ctx.userId || !ctx.sessionId) return;

    sessionStartRef.current = Date.now();
    lastEventAtRef.current = Date.now();
    lastCodeLengthRef.current = editorRef.current?.getValue?.().length || 0;
    lastSnapshotCodeLengthRef.current = lastCodeLengthRef.current;
    lastSnapshotAtRef.current = Date.now();
    blockStartAtRef.current = Date.now();

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;
    ws.onopen = () => {
      void flushBuffer();
    };

    flushTimerRef.current = window.setInterval(() => {
      const now = Date.now();
      const idleSinceLastKey = lastKeyDownAtRef.current ? now - lastKeyDownAtRef.current : 0;
      if (idleSinceLastKey > 3000 && now - lastIdleEmissionRef.current >= FLUSH_INTERVAL_MS) {
        const idleDelta = Math.max(0, idleSinceLastKey - (lastIdleEmissionRef.current ? now - lastIdleEmissionRef.current : 0));
        totalIdleMsRef.current += Math.max(0, idleDelta);
        lastIdleEmissionRef.current = now;
        pushEvent({
          action_type: "idle",
          idle_ms: idleSinceLastKey,
          pause_duration_ms: idleSinceLastKey,
          pause_duration: idleSinceLastKey,
          key_pressed: "idle",
        });
      }
      void flushBuffer();
    }, FLUSH_INTERVAL_MS);

    return () => {
      if (flushTimerRef.current) {
        window.clearInterval(flushTimerRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.userId, ctx.sessionId]);

  const attach = () => {
    const editor = editorRef.current;
    if (!editor || !ctx.userId || !ctx.sessionId) return () => {};

    const keyDisposable = editor.onKeyDown?.((e: any) => {
      const now = Date.now();
      const key = String(e?.browserEvent?.key || e?.keyCode || "");
      const isBackspace = e?.keyCode === 8 || key === "Backspace";
      const isDelete = e?.keyCode === 46 || key === "Delete";
      const isPasteShortcut = (e?.ctrlKey || e?.metaKey) && String(key).toLowerCase() === "v";

      const pauseSinceLastKey = lastKeyDownAtRef.current ? now - lastKeyDownAtRef.current : 0;
      lastKeyDownAtRef.current = now;

      if (pauseSinceLastKey > 0) {
        totalIdleMsRef.current += pauseSinceLastKey;
      }

      let hesitationCount = 0;
      const position = editor.getPosition?.();
      const model = editor.getModel?.();
      const lineText = position && model ? model.getLineContent(position.lineNumber) || "" : "";
      const atLineEnd = !position ? true : position.column >= (lineText.length + 1);
      if (pauseSinceLastKey > 2000 && !atLineEnd) {
        hesitationCount = 1;
      }

      if (isBackspace) {
        backspaceStreakRef.current += 1;
      } else if (!isDelete) {
        backspaceStreakRef.current = 0;
      }

      const deletionBursts = backspaceStreakRef.current === 6 ? 1 : 0;

      if (isPasteShortcut) {
        pendingPasteRef.current = true;
        pendingPasteAtRef.current = now;
      }

      totalKeystrokesRef.current += 1;

      pushEvent({
        action_type: isDelete || isBackspace ? "delete" : "insert",
        key_pressed: key,
        backspace_count: isBackspace ? 1 : 0,
        deletion_bursts: deletionBursts,
        hesitation_count: hesitationCount,
      });
    });

    const typeDisposable = editor.onDidType?.((text: string) => {
      if (!text) return;
      const now = Date.now();
      const code = editor.getValue?.() || "";
      const previousLength = lastCodeLengthRef.current;
      const currentLength = code.length;
      const delta = currentLength - previousLength;
      const dt = lastCodeChangeAtRef.current ? now - lastCodeChangeAtRef.current : 0;
      lastCodeLengthRef.current = currentLength;
      lastCodeChangeAtRef.current = now;

      totalTypedCharsRef.current += text.length;
      rollingTypedCharsRef.current.push({ ts: now, count: text.length });

      const pasteByShortcut = pendingPasteRef.current && now - pendingPasteAtRef.current <= 800;
      const pasteByPayload = text.length >= 40 || text.includes("\n");
      const isPaste = pasteByShortcut || pasteByPayload;
      if (pendingPasteRef.current && now - pendingPasteAtRef.current > 800) {
        pendingPasteRef.current = false;
      }
      if (isPaste) pendingPasteRef.current = false;

      const pastedLineCount = isPaste ? Math.max(1, text.split("\n").length) : 0;
      const pastedCharCount = isPaste ? text.length : 0;

      const burstInsertDetected = !isPaste && delta > 150 && dt > 0 && dt < 200;

      let blockDurationMs = 0;
      if (text.includes("\n\n") || text.includes("}") || text.includes("]") || text.includes(")")) {
        blockDurationMs = Math.max(0, now - blockStartAtRef.current);
        blockStartAtRef.current = now;
      }

      pushEvent({
        action_type: isPaste ? "paste" : "insert",
        is_paste_event: isPaste,
        paste_detected: isPaste,
        paste_line_count: pastedLineCount,
        paste_char_count: pastedCharCount,
        pasted_line_count: pastedLineCount,
        pasted_char_count: pastedCharCount,
        burst_insert_detected: burstInsertDetected,
        block_duration_ms: blockDurationMs,
      });
    });

    const cursorDisposable = editor.onDidChangeCursorPosition?.((e: any) => {
      const newLine = e?.position?.lineNumber;
      const oldLine = e?.position?.lineNumber ? lastLineRef.current : null;
      const now = Date.now();

      if (typeof oldLine === "number" && typeof newLine === "number" && newLine !== oldLine) {
        linesMovedAwayRef.current.add(oldLine);
        lineEnteredAtRef.current = now;
        pushEvent({ action_type: "navigate" });
      }

      if (typeof newLine === "number") {
        lastLineRef.current = newLine;
      }
    });

    const contentDisposable = editor.onDidChangeModelContent?.((e: any) => {
      const now = Date.now();
      const position = editor.getPosition?.();
      const lineNumber = position?.lineNumber;

      let lineRewrites = 0;
      if (typeof lineNumber === "number" && linesMovedAwayRef.current.has(lineNumber)) {
        lineRewrites = 1;
        linesMovedAwayRef.current.delete(lineNumber);
      }

      const currentLength = (editor.getValue?.() || "").length;
      const codeRewriteCount = (lastCodeLengthRef.current - currentLength) > 80 ? 1 : 0;
      lastCodeLengthRef.current = currentLength;

      let errorCount = 0;
      try {
        const model = editor.getModel?.();
        const monacoApi = (window as any)?.monaco;
        const markers = model && monacoApi?.editor?.getModelMarkers
          ? monacoApi.editor.getModelMarkers({ resource: model.uri })
          : [];
        errorCount = (markers || []).filter((m: any) => m?.severity === 8).length;
      } catch {
        errorCount = 0;
      }

      let errorRecoveryTimeMs: number | null = null;
      if (errorCount > errorCountRef.current) {
        errorIncreasedAtRef.current = now;
      }
      if (errorCount < errorCountRef.current && errorIncreasedAtRef.current) {
        errorRecoveryTimeMs = now - errorIncreasedAtRef.current;
        errorIncreasedAtRef.current = null;
      }
      errorCountRef.current = errorCount;

      pushEvent({
        action_type: "insert",
        line_rewrites: lineRewrites,
        code_rewrite_count: codeRewriteCount,
        error_count: errorCount,
        error_recovery_time_ms: errorRecoveryTimeMs,
      });

      // avoid unbounded buffer growth if many editor updates happen before next flush cycle
      if (bufferRef.current.length > 300) {
        void flushBuffer();
      }
    });

    return () => {
      keyDisposable?.dispose?.();
      typeDisposable?.dispose?.();
      cursorDisposable?.dispose?.();
      contentDisposable?.dispose?.();
    };
  };

  const recordCustomEvent = (partial: Partial<KeystrokeEvent>) => {
    pushEvent(partial);
  };

  const forceFlush = () => {
    pushEvent({
      action_type: "idle",
      is_completing: true,
      key_pressed: "complete",
      block_duration_ms: Math.max(0, Date.now() - blockStartAtRef.current),
      idle_ms: 0,
    });
    void flushBuffer();
  };

  return { attach, recordCustomEvent, forceFlush };
}
