/**
 * Enhanced Keystroke Tracker Hook
 * Production-ready keystroke tracking with full metrics calculation
 * Integrates with Monaco/CodeMirror/textarea
 */

import { useEffect, useRef, useCallback } from "react";
import { KeystrokeMetricsCalculator, type RawKeystrokeEvent, type KeystrokeMetrics } from "../lib/keystrokeMetricsCalculator";
import { KeystrokeRetryQueue } from "../lib/keystrokeRetryQueue";

export interface UseKeystrokeTrackerOptions {
  userId: string | null;
  testId: string;
  editorRef: any; // Monaco editor, CodeMirror, or textarea element
  enabled?: boolean;
  batchSize?: number; // How many events before sending
  flushInterval?: number; // How often to flush (ms)
  onError?: (error: Error) => void;
}

export function useEnhancedKeystrokeTracker(options: UseKeystrokeTrackerOptions) {
  const {
    userId,
    testId,
    editorRef,
    enabled = true,
    batchSize = 5,
    flushInterval = 3000, // 3 seconds
    onError,
  } = options;

  // State refs
  const calculatorRef = useRef(new KeystrokeMetricsCalculator());
  const retryQueueRef = useRef(new KeystrokeRetryQueue());
  const bufferRef = useRef<KeystrokeMetrics[]>([]);
  const lastCodeRef = useRef("");
  const lastMetricsRef = useRef<Partial<KeystrokeMetrics>>({});
  const flushTimerRef = useRef<number | null>(null);
  const isListeningRef = useRef(false);

  /**
   * Get current code from editor
   */
  const getEditorCode = useCallback((): string => {
    if (!editorRef?.current) return "";

    // Monaco Editor
    if (typeof editorRef.current.getValue === "function") {
      return editorRef.current.getValue();
    }

    // CodeMirror
    if (typeof editorRef.current.getDoc === "function") {
      return editorRef.current.getDoc().getValue();
    }

    // Textarea
    if (editorRef.current instanceof HTMLTextAreaElement) {
      return editorRef.current.value;
    }

    return "";
  }, [editorRef]);

  /**
   * Get cursor position from editor
   */
  const getCursorPosition = useCallback((): number => {
    if (!editorRef?.current) return 0;

    // Monaco Editor
    if (typeof editorRef.current.getPosition === "function") {
      const pos = editorRef.current.getPosition();
      return pos ? editorRef.current.getModel?.()?.getOffsetAt(pos) || 0 : 0;
    }

    // CodeMirror
    if (typeof editorRef.current.getCursor === "function") {
      const cursor = editorRef.current.getCursor();
      return editorRef.current.indexFromPos(cursor);
    }

    // Textarea
    if (editorRef.current instanceof HTMLTextAreaElement) {
      return editorRef.current.selectionStart;
    }

    return 0;
  }, [editorRef]);

  /**
   * Get current line number from editor
   */
  const getLineNumber = useCallback((): number => {
    if (!editorRef?.current) return 0;

    // Monaco Editor
    if (typeof editorRef.current.getPosition === "function") {
      const pos = editorRef.current.getPosition();
      return pos?.lineNumber || 0;
    }

    // CodeMirror
    if (typeof editorRef.current.getCursor === "function") {
      const cursor = editorRef.current.getCursor();
      return cursor.line;
    }

    // Textarea - count newlines before cursor
    if (editorRef.current instanceof HTMLTextAreaElement) {
      const text = editorRef.current.value.substring(0, editorRef.current.selectionStart);
      return text.split("\n").length - 1;
    }

    return 0;
  }, [editorRef]);

  /**
   * Detect paste event
   */
  const detectPaste = useCallback(
    (currentCode: string, lastCode: string): { isPaste: boolean; pasteChars?: number; pasteLines?: number } => {
      // If code grew significantly, likely a paste
      const charDiff = currentCode.length - lastCode.length;
      const isPaste = charDiff > 10; // More than 10 chars added at once

      if (isPaste) {
        const newLines = (currentCode.match(/\n/g) || []).length - (lastCode.match(/\n/g) || []).length;
        return {
          isPaste: true,
          pasteChars: charDiff,
          pasteLines: Math.max(0, newLines),
        };
      }

      return { isPaste: false };
    },
    []
  );

  /**
   * Handle keyboard event and calculate metrics
   */
  const handleKeydown = useCallback(
    (event: KeyboardEvent) => {
      if (!enabled || !userId) return;

      const currentCode = getEditorCode();
      const cursorPos = getCursorPosition();
      const lineNum = getLineNumber();

      // Create raw keystroke event
      const rawEvent: RawKeystrokeEvent = {
        key: event.key,
        timestamp: Date.now(),
        cursorPos,
        lineNum,
        prevLineNum: lastMetricsRef.current.prev_line_number || lineNum - 1,
        code: currentCode,
        isPaste: event.ctrlKey && event.key === "v",
        ...detectPaste(currentCode, lastCodeRef.current),
      };

      // Calculate metrics
      try {
        const metrics = calculatorRef.current.calculate(rawEvent, lastCodeRef.current, lastMetricsRef.current);

        // Add user and test context
        metrics.user_id = userId;
        metrics.test_id = testId;
        metrics.timestamp = new Date().toISOString();

        // Add to buffer
        bufferRef.current.push(metrics);
        lastMetricsRef.current = metrics;
        lastCodeRef.current = currentCode;

        console.log(`[KeystrokeTracker] ✅ Captured keystroke: ${event.key} (keystroke_count: ${metrics.keystroke_count})`);

        // Flush if buffer reaches size limit
        if (bufferRef.current.length >= batchSize) {
          flushBuffer();
        }
      } catch (error) {
        console.error("[KeystrokeTracker] Error calculating metrics:", error);
        if (onError) onError(error instanceof Error ? error : new Error(String(error)));
      }
    },
    [enabled, userId, testId, getEditorCode, getCursorPosition, getLineNumber, detectPaste, batchSize, onError]
  );

  /**
   * Flush buffer to backend
   */
  const flushBuffer = useCallback(async () => {
    if (bufferRef.current.length === 0 || !userId) return;

    const events = bufferRef.current.splice(0, bufferRef.current.length);
    console.log(`[KeystrokeTracker] Flushing ${events.length} events to backend...`);

    try {
      const response = await fetch(
        `${import.meta.env.VITE_CODE_RUNNER_URL || "https://mind-code-gilt.vercel.app"}/api/keystroke-logs`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ events }),
        }
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();
      if (result.error) {
        throw new Error(result.error);
      }

      console.log(`[KeystrokeTracker] ✅ Successfully flushed ${events.length} events`);
    } catch (error) {
      console.error("[KeystrokeTracker] Flush failed, adding to retry queue:", error);

      // Add events to retry queue
      for (const event of events) {
        try {
          await retryQueueRef.current.enqueue(event);
        } catch (queueError) {
          console.error("[KeystrokeTracker] Failed to enqueue for retry:", queueError);
          if (onError) onError(queueError instanceof Error ? queueError : new Error(String(queueError)));
        }
      }
    }
  }, [userId, onError]);

  /**
   * Handle editor blur - flush remaining events
   */
  const handleEditorBlur = useCallback(() => {
    console.log("[KeystrokeTracker] Editor blur - flushing remaining events");
    flushBuffer();
  }, [flushBuffer]);

  /**
   * Initialize keystroke tracking
   */
  useEffect(() => {
    if (!enabled || !userId || isListeningRef.current) return;

    console.log("[KeystrokeTracker] ✅ Initializing keystroke tracking");

    // Initialize retry queue from IndexedDB
    retryQueueRef.current.loadFromIndexedDB().catch((err) => {
      console.error("[KeystrokeTracker] Failed to load retry queue:", err);
    });

    const editor = editorRef?.current;
    if (!editor) {
      console.warn("[KeystrokeTracker] Editor reference not found");
      return;
    }

    // Attach event listeners
    if (editor instanceof HTMLElement) {
      editor.addEventListener("keydown", handleKeydown);
      editor.addEventListener("blur", handleEditorBlur);
    } else if (typeof editor.onKeyDown === "function") {
      // Monaco Editor
      editor.onKeyDown(handleKeydown);
    } else if (typeof editor.on === "function") {
      // CodeMirror
      editor.on("keydown", handleKeydown);
      editor.on("blur", handleEditorBlur);
    }

    isListeningRef.current = true;

    // Set up periodic flush timer
    flushTimerRef.current = window.setInterval(() => {
      if (bufferRef.current.length > 0) {
        console.log(`[KeystrokeTracker] Periodic flush (${bufferRef.current.length} events in buffer)`);
        flushBuffer();
      }
    }, flushInterval);

    // Cleanup
    return () => {
      if (flushTimerRef.current) clearInterval(flushTimerRef.current);

      if (editor instanceof HTMLElement) {
        editor.removeEventListener("keydown", handleKeydown);
        editor.removeEventListener("blur", handleEditorBlur);
      }

      isListeningRef.current = false;
      console.log("[KeystrokeTracker] Cleanup complete");
    };
  }, [enabled, userId, editorRef, handleKeydown, handleEditorBlur, flushBuffer, flushInterval]);

  /**
   * Flush on page unload
   */
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (bufferRef.current.length > 0) {
        console.log("[KeystrokeTracker] Flushing before unload");
        // Try sync flush (best effort)
        const events = bufferRef.current;
        navigator.sendBeacon(
          `${import.meta.env.VITE_CODE_RUNNER_URL || "https://mind-code-gilt.vercel.app"}/api/keystroke-logs`,
          JSON.stringify({ events })
        );
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, []);

  /**
   * Public API to manually flush or check status
   */
  return {
    flush: flushBuffer,
    getBufferSize: () => bufferRef.current.length,
    getRetryQueueStatus: () => retryQueueRef.current.getStatus(),
    clearRetryQueue: () => retryQueueRef.current.clearQueue(),
  };
}
