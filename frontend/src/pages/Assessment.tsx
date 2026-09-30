import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import Editor, { OnMount } from "@monaco-editor/react";
import * as blazeface from "@tensorflow-models/blazeface";
import * as tf from "@tensorflow/tfjs";
import "@tensorflow/tfjs-backend-webgl";
import {
  Play,
  Send,
  Maximize2,
  Camera,
  Activity,
  Brain,
  Keyboard,
  Clock,
  AlertCircle,
  PauseCircle,
  Loader2,
} from "lucide-react";
import GlowButton from "@/components/GlowButton";
import DifficultyBadge from "@/components/DifficultyBadge";
import {
  useAssessmentSession,
  struggleScore,
  heatColor,
} from "@/hooks/useAssessmentSession";
import { useKeystrokeTracker } from "@/hooks/useKeystrokeTracker";
import useSupabaseAuth from "@/hooks/useSupabaseAuth";
import { cn } from "@/lib/utils";
import { runCode } from "@/lib/codeRunner";
import { getSupabaseClient, hasSupabaseEnv } from "@/lib/supabase";

const formatTime = (seconds: number) => {
  const m = Math.floor(seconds / 60).toString().padStart(2, "0");
  const s = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
};

const getDurationForDifficulty = (difficulty: string) => {
  const d = String(difficulty || "").toLowerCase();
  if (d === "easy") return 25 * 60;
  if (d === "hard") return 45 * 60;
  return 35 * 60;
};

const Assessment = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const editorRef = useRef<any>(null);
  const cameraVideoRef = useRef<HTMLVideoElement | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const faceModelRef = useRef<blazeface.BlazeFaceModel | null>(null);
  const lookAwaySinceRef = useRef<number | null>(null);
  const noFaceSinceRef = useRef<number | null>(null);
  const nonCenterSinceRef = useRef<number | null>(null);
  const warningTriggeredForCurrentNonCenterRef = useRef(false);
  const previousDirectionRef = useRef<"center" | "left" | "right" | "no-face">("center");
  const prevKeystrokesRef = useRef(0);
  const prevBackspacesRef = useRef(0);
  const tabSwitchPenaltyRef = useRef(0);
  const lineMetricsRef = useRef<Record<number, { edits: number; backspaces: number }>>({});
  const [submitting, setSubmitting] = useState(false);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [language, setLanguage] = useState("python");
  const [consoleOutput, setConsoleOutput] = useState("");
  const [testsPassed, setTestsPassed] = useState(0);
  const [timer, setTimer] = useState(getDurationForDifficulty("medium"));
  const [tabSwitchCount, setTabSwitchCount] = useState(0);
  const [storedKeystrokes, setStoredKeystrokes] = useState<number | null>(null);
  const [storedPauseMs, setStoredPauseMs] = useState<number | null>(null);
  const [latestEmotion, setLatestEmotion] = useState<string>("unknown");
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [headDirection, setHeadDirection] = useState<"center" | "left" | "right" | "no-face">("center");
  const [headWarningCount, setHeadWarningCount] = useState(0);
  const [headMovementCount, setHeadMovementCount] = useState(0);
  const [isAssessmentPaused, setIsAssessmentPaused] = useState(false);
  const [guardNotice, setGuardNotice] = useState<string | null>(null);
  const keystrokeAttachRef = useRef<() => void>();
  const endingRef = useRef(false);
  const lastPenaltyAtRef = useRef(0);
  const lastHeadWarningAtRef = useRef(0);

  const {
    sessionId,
    problem,
    code,
    setCode,
    lineMetrics,
    behaviorTimeline,
    recordLineMetric,
    pushBehaviorPoint,
    recordFocusDrop,
    recordFullscreenExit,
    completeAssessment,
    difficulty,
    setRunVerdict,
  } = useAssessmentSession();

  const { user } = useSupabaseAuth();

  const localKeystrokes = useMemo(() => Object.values(lineMetrics).reduce((a, m) => a + m.edits, 0), [lineMetrics]);
  const localPauseMs = useMemo(() => Object.values(lineMetrics).reduce((a, m) => a + m.timeMs, 0), [lineMetrics]);
  const keystrokesValue = Math.max(storedKeystrokes ?? 0, localKeystrokes);
  const pauseValueMs = Math.max(storedPauseMs ?? 0, localPauseMs);
  const liveFocus = Math.round(Math.max(10, Math.min(98, behaviorTimeline.at(-1)?.focus ?? 70)));

  useEffect(() => {
    lineMetricsRef.current = lineMetrics;
  }, [lineMetrics]);

  useEffect(() => {
    prevKeystrokesRef.current = 0;
    prevBackspacesRef.current = 0;
    tabSwitchPenaltyRef.current = 0;
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId || sessionId !== id) {
      navigate("/dashboard");
    } else {
      setLanguage(useAssessmentSession.getState().language);
    }
  }, [sessionId, id, navigate]);

  useEffect(() => {
    if (!problem || endingRef.current) return;
    setTimer(getDurationForDifficulty(difficulty));
  }, [sessionId, difficulty, problem]);

  useEffect(() => {
    const interval = setInterval(() => {
      setTimer((t) => {
        if (endingRef.current || isAssessmentPaused) return t;
        return Math.max(0, t - 1);
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [isAssessmentPaused]);

  useEffect(() => {
    if (!problem || endingRef.current) return;

    let cancelled = false;

    const startCamera = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 640 },
            height: { ideal: 360 },
            facingMode: "user",
          },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        cameraStreamRef.current = stream;
        const videoEl = cameraVideoRef.current;
        if (videoEl) {
          videoEl.srcObject = stream;
          await videoEl.play();
        }
        setCameraError(null);
        setCameraReady(true);
      } catch {
        setCameraReady(false);
        setCameraError("Camera permission is required for proctoring.");
        setGuardNotice("Camera access denied. Please enable camera to continue safely.");
      }
    };

    void startCamera();

    return () => {
      cancelled = true;
      setCameraReady(false);
      const stream = cameraStreamRef.current;
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
        cameraStreamRef.current = null;
      }
    };
  }, [problem]);

  useEffect(() => {
    if (!cameraReady) return;
    const videoEl = cameraVideoRef.current;
    const stream = cameraStreamRef.current;
    if (!videoEl || !stream) return;

    if (videoEl.srcObject !== stream) {
      videoEl.srcObject = stream;
    }
    void videoEl.play().catch(() => {
      // Ignore autoplay race; preview will retry on next state change.
    });
  }, [cameraReady]);

  const forceEndExam = async (reason: string) => {
    if (endingRef.current) return;
    endingRef.current = true;
    setSubmitting(true);
    setGuardNotice(reason);
    setConsoleOutput(`Exam ended: ${reason}\nGenerating final report...`);
    try {
      // Flush keystroke data before completing assessment
      if (keystrokeTracker?.forceFlush) {
        keystrokeTracker.forceFlush();
      }
      const report = await completeAssessment();
      if (document.fullscreenElement) {
        await document.exitFullscreen().catch(() => undefined);
      }
      if (report?.id) {
        navigate(`/result/${report.id}`);
      } else {
        navigate("/dashboard");
      }
    } finally {
      setSubmitting(false);
    }
  };

  const raiseHeadWarning = (message: string) => {
    const now = Date.now();
    if (now - lastHeadWarningAtRef.current < 2500) return;
    lastHeadWarningAtRef.current = now;
    setHeadWarningCount((count) => {
      const next = count + 1;
      setGuardNotice(`Warning ${next}: ${message}`);
      if (next >= 3 && !endingRef.current) {
        void forceEndExam("Assessment closed: 3 proctoring warnings reached.");
      }
      return next;
    });
    recordFocusDrop();
  };

  // Enter fullscreen for exam lock mode. Retry after user interaction if browser blocks initial request.
  useEffect(() => {
    if (!problem || endingRef.current) return;
    let cancelled = false;
    const requestLock = () => {
      if (cancelled || endingRef.current || document.fullscreenElement) return;
      document.documentElement.requestFullscreen().then(() => {
        setGuardNotice(null);
      }).catch(() => {
        setGuardNotice("Please allow fullscreen. Exiting fullscreen will end the exam.");
      });
    };

    requestLock();
    const retryId = window.setInterval(requestLock, 1500);
    window.addEventListener("pointerdown", requestLock, true);
    window.addEventListener("keydown", requestLock, true);
    return () => {
      cancelled = true;
      window.clearInterval(retryId);
      window.removeEventListener("pointerdown", requestLock, true);
      window.removeEventListener("keydown", requestLock, true);
    };
  }, [problem]);

  // Focus + anti-cheat hooks
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) {
        recordFocusDrop();
        const now = Date.now();
        if (now - lastPenaltyAtRef.current < 1200) return;
        lastPenaltyAtRef.current = now;

        setTabSwitchCount((count) => count + 1);
        setTimer((t) => Math.max(0, t - 10 * 60));
        setGuardNotice("Tab switch detected: 10 minutes deducted.");
      }
    };
    const onFull = () => {
      const fs = !!document.fullscreenElement;
      if (!fs && !endingRef.current) {
        recordFullscreenExit();
        void forceEndExam("Fullscreen exit detected");
      }
    };

    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (endingRef.current) return;
      e.preventDefault();
      e.returnValue = "";
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (endingRef.current) return;
      const key = e.key.toLowerCase();
      const meta = e.metaKey || e.ctrlKey;
      const blocked =
        key === "f11" ||
        (meta && ["w", "t", "n", "r", "l"].includes(key)) ||
        (e.altKey && key === "tab");
      if (blocked) {
        e.preventDefault();
        e.stopPropagation();
        setGuardNotice("Exam lock is active. Leaving the exam will end your session.");
      }
    };

    document.addEventListener("visibilitychange", onVisibility);
    document.addEventListener("fullscreenchange", onFull);
    window.addEventListener("beforeunload", onBeforeUnload);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      document.removeEventListener("fullscreenchange", onFull);
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [recordFocusDrop, recordFullscreenExit]);

  // Behavior timeline sampling
  useEffect(() => {
    const onHide = () => {
      tabSwitchPenaltyRef.current += 1;
    };
    document.addEventListener('visibilitychange', onHide);
    return () => document.removeEventListener('visibilitychange', onHide);
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      // Get cumulative totals
      const latestMetrics = lineMetricsRef.current || {};
      const totalKeystrokes = Object.values(latestMetrics).reduce((acc, m) => acc + m.edits, 0);
      const totalBackspaces = Object.values(latestMetrics).reduce((acc, m) => acc + m.backspaces, 0);

      // Derive DELTA for this 5-second window
      const deltaKeys = Math.max(0, totalKeystrokes - prevKeystrokesRef.current);
      const deltaBacks = Math.max(0, totalBackspaces - prevBackspacesRef.current);
      prevKeystrokesRef.current = totalKeystrokes;
      prevBackspacesRef.current = totalBackspaces;

      // Base focus from typing activity in this window
      // deltaKeys=0 means idle → low focus. deltaKeys>10 means active → high focus
      let focus = 50; // default: moderate
      if (deltaKeys === 0 && deltaBacks === 0) {
        focus = 35; // completely idle this window
      } else if (deltaKeys > 15) {
        focus = 88 + Math.min(10, deltaKeys - 15); // fast typing = high focus, max 98
      } else if (deltaKeys > 8) {
        focus = 70 + deltaKeys * 1.2; // moderate typing
      } else if (deltaKeys > 0) {
        focus = 45 + deltaKeys * 3; // slow typing
      }

      // Penalise deletion bursts this window
      if (deltaBacks > 8) focus -= 18;
      else if (deltaBacks > 4) focus -= 10;
      else if (deltaBacks > 1) focus -= 4;

      // Penalise tab switches: -20% per switch since last sample
      const tabPenalty = tabSwitchPenaltyRef.current * 20;
      focus -= tabPenalty;
      tabSwitchPenaltyRef.current = 0; // reset after applying

      // Clamp to realistic range
      focus = Math.round(Math.max(10, Math.min(98, focus)));

      pushBehaviorPoint({
        timestamp: Date.now(),
        focus,
        keystrokes: totalKeystrokes,
        backspaces: totalBackspaces,
      });
    }, 5000);
    return () => clearInterval(interval);
  }, [pushBehaviorPoint]);

  const keystrokeTracker = useKeystrokeTracker(editorRef, {
    userId: user?.id || null,
    sessionId: sessionId || "",
    problemId: problem?.title,
  });

  // Cleanup: flush keystroke data on component unmount
  useEffect(() => {
    return () => {
      if (keystrokeTracker?.forceFlush) {
        keystrokeTracker.forceFlush();
      }
    };
  }, [keystrokeTracker]);

  useEffect(() => {
    if (!hasSupabaseEnv || !user?.id || !sessionId) return;

    let active = true;
    const loadTelemetry = async () => {
      try {
        const supa = getSupabaseClient();
        const [{ data: ks }, { data: emo }] = await Promise.all([
          supa
            .from("keystroke_logs")
            .select("pause_duration, backspace_count")
            .eq("user_id", user.id)
            .or(`test_id.eq.${sessionId},test_id.is.null`),
          supa
            .from("emotion_logs")
            .select("emotion, timestamp")
            .eq("user_id", user.id)
            .or(`test_id.eq.${sessionId},test_id.is.null`)
            .order("timestamp", { ascending: false })
            .limit(1),
        ]);

        if (!active) return;
        const points = ks || [];
        const pause = points.reduce((acc, row) => acc + Number(row.pause_duration || 0), 0);
        setStoredKeystrokes(points.length);
        setStoredPauseMs(pause);
        setLatestEmotion(emo?.[0]?.emotion || "unknown");
      } catch {
        // Keep panel usable with local metrics when remote fetch fails.
      }
    };

    void loadTelemetry();
    const interval = window.setInterval(loadTelemetry, 4000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [sessionId, user?.id]);

  useEffect(() => {
    if (!cameraReady || !cameraVideoRef.current || endingRef.current) return;

    let cancelled = false;
    let isRunning = false;
    let intervalId: number | null = null;

    const estimateHeadDirection = async () => {
      if (isRunning || cancelled || endingRef.current) return;
      const video = cameraVideoRef.current;
      if (!video || video.readyState < 2 || video.videoWidth === 0 || video.videoHeight === 0) return;
      if (!faceModelRef.current) return;

      isRunning = true;
      try {
        const faces = await faceModelRef.current.estimateFaces(video, false);
        const now = Date.now();

        if (!faces.length) {
          setHeadDirection("no-face");
          lookAwaySinceRef.current = null;
          if (!noFaceSinceRef.current) noFaceSinceRef.current = now;
          if (now - noFaceSinceRef.current > 1200) {
            raiseHeadWarning("Face not detected. Keep your face centered in camera.");
            noFaceSinceRef.current = now;
          }
          return;
        }

        noFaceSinceRef.current = null;

        const face = faces[0];
        const landmarks = face.landmarks as [number, number][];
        const rightEye = landmarks?.[0];
        const leftEye = landmarks?.[1];
        const nose = landmarks?.[2];

        const topLeft = face.topLeft as [number, number];
        const bottomRight = face.bottomRight as [number, number];
        const centerX = (topLeft[0] + bottomRight[0]) / 2;
        const centerXNorm = centerX / video.videoWidth;

        const eyeMidX = rightEye && leftEye ? (rightEye[0] + leftEye[0]) / 2 : centerX;
        const eyeDistance = rightEye && leftEye ? Math.max(1, Math.abs(leftEye[0] - rightEye[0])) : 1;
        const yaw = nose ? (nose[0] - eyeMidX) / eyeDistance : 0;

        const lookingLeft = yaw < -0.16 || centerXNorm < 0.3;
        const lookingRight = yaw > 0.16 || centerXNorm > 0.7;
        const direction = lookingLeft ? "left" : lookingRight ? "right" : "center";
        setHeadDirection(direction);

        if (direction === "left" || direction === "right") {
          if (!lookAwaySinceRef.current) lookAwaySinceRef.current = now;
          const lookAwayMs = now - lookAwaySinceRef.current;
          if (lookAwayMs > 900) {
            raiseHeadWarning(`Looking ${direction} detected. Keep your head centered.`);
            lookAwaySinceRef.current = now;
          }
        } else {
          lookAwaySinceRef.current = null;
        }
      } catch {
        // Keep exam usable if inference fails for a frame.
      } finally {
        isRunning = false;
      }
    };

    const startDetection = async () => {
      try {
        await tf.ready();
        if (tf.getBackend() !== "webgl") {
          await tf.setBackend("webgl").catch(async () => {
            await tf.setBackend("cpu");
          });
          await tf.ready();
        }
        if (!faceModelRef.current) {
          faceModelRef.current = await blazeface.load();
        }
        intervalId = window.setInterval(() => {
          void estimateHeadDirection();
        }, 1200);
      } catch {
        setCameraError("Unable to start head tracking on this browser.");
      }
    };

    void startDetection();

    return () => {
      cancelled = true;
      if (intervalId) window.clearInterval(intervalId);
    };
  }, [cameraReady, recordFocusDrop]);

  useEffect(() => {
    if (!cameraReady || endingRef.current) return;

    const shouldPause = headDirection !== "center";
    setIsAssessmentPaused((prev) => {
      if (prev === shouldPause) return prev;
      if (shouldPause) {
        setGuardNotice("Assessment paused: keep your head centered to resume.");
      } else {
        setGuardNotice("Head centered. Assessment resumed.");
      }
      return shouldPause;
    });

    const previous = previousDirectionRef.current;
    if (
      (headDirection === "left" || headDirection === "right") &&
      headDirection !== previous
    ) {
      setHeadMovementCount((count) => count + 1);
    }
    previousDirectionRef.current = headDirection;

    if (headDirection !== "center") {
      if (!nonCenterSinceRef.current) {
        nonCenterSinceRef.current = Date.now();
        warningTriggeredForCurrentNonCenterRef.current = false;
      }
      if (!warningTriggeredForCurrentNonCenterRef.current && Date.now() - nonCenterSinceRef.current > 900) {
        const message = headDirection === "no-face"
          ? "Face not visible."
          : `Looking ${headDirection} detected.`;
        raiseHeadWarning(`${message} Keep your head centered.`);
        warningTriggeredForCurrentNonCenterRef.current = true;
      }
    } else {
      nonCenterSinceRef.current = null;
      warningTriggeredForCurrentNonCenterRef.current = false;
    }
  }, [cameraReady, headDirection]);

  const handleRun = () => {
    if (isAssessmentPaused) {
      setGuardNotice("Assessment is paused due to head position. Center your head to continue.");
      return;
    }
    setRunning(true);
    setRunError(null);
    const sample = problem.examples?.[0];
    setConsoleOutput(sample ? "Running sample test #1 via Judge0..." : "Submitting code to Judge0 via backend...");
    const safeLanguage = (["python", "javascript", "java", "cpp", "c", "go", "rust"].includes(language) ? language : "python") as
      | "python"
      | "javascript"
      | "java"
      | "cpp"
      | "c"
      | "go"
      | "rust";
    runCode({
      language: safeLanguage,
      code,
      stdin: sample?.input ?? "",
    })
      .then((result) => {
        const normalizeComparable = (s: string) =>
          (s || "")
            .replace(/\r\n/g, "\n")
            .split("\n")
            .map((line) => line.replace(/\s+$/g, ""))
            .join("\n")
            .trim();

        if (sample?.output != null) {
          const expected = normalizeComparable(sample.output);
          const actual = normalizeComparable(result.output || result.error || "");
          const match = expected === actual;
          setRunVerdict({ passed: match, expected, actual, sampleInput: sample.input });
          setTestsPassed(match ? 2 : 0);
        } else {
          setRunVerdict({
            passed: result.statusId === 3,
            expected: undefined,
            actual: normalizeComparable(result.output || result.error || ""),
            sampleInput: sample?.input,
          });
          setTestsPassed(result.statusId === 3 ? 2 : 0);
        }

        const output = (result.output ?? "").toString();
        const error = (result.error ?? "").toString();
        setConsoleOutput(output || error || "No output received.");
      })
      .catch((err: any) => {
        const message = err?.message || "Unable to run code.";
        setRunError(message);
        setConsoleOutput(message);
        setTestsPassed(0);
        setRunVerdict({ passed: null, expected: undefined, actual: undefined, sampleInput: sample?.input });
      })
      .finally(() => setRunning(false));
  };

  const handleSubmit = async () => {
    if (isAssessmentPaused) {
      setGuardNotice("Assessment is paused due to head position. Center your head to submit.");
      return;
    }
    endingRef.current = true;
    setSubmitting(true);
    setConsoleOutput("Evaluating with full suite...\nRuntime OK\nGenerating AI analysis...");
    try {
      // Force flush all pending keystroke logs before completing assessment
      keystrokeTracker.forceFlush();
      
      const report = await completeAssessment();
      if (document.fullscreenElement) {
        await document.exitFullscreen().catch(() => undefined);
      }
      if (report) navigate(`/result/${report.id}`);
    } finally {
      setSubmitting(false);
    }
  };

  const onMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    editor.focus();

    // Attach keystroke tracker
    keystrokeAttachRef.current?.();
    const detach = keystrokeTracker.attach();
    keystrokeAttachRef.current = detach;

    editor.onDidChangeCursorPosition((e) => {
      const line = e.position.lineNumber;
      recordLineMetric(line, { timeMs: 400 });
    });
    editor.onDidChangeModelContent((e) => {
      const line = editor.getPosition()?.lineNumber || 1;
      const backspaces = e.changes.filter((c) => c.rangeLength > 0 && c.text === "").length;
      const insertedChars = e.changes.reduce((acc, c) => acc + (c.text?.length || 0), 0);
      const insertedLines = e.changes.reduce((acc, c) => acc + ((c.text?.match(/\n/g)?.length || 0)), 0);
      const suspiciousPaste = insertedChars >= 80 || insertedLines >= 2;
      const model = editor.getModel();
      const markers = model
        ? monaco.editor.getModelMarkers({ resource: model.uri })
        : [];
      const errorCount = markers.filter((marker) => marker.severity === monaco.MarkerSeverity.Error).length;
      recordLineMetric(line, {
        edits: e.changes.length,
        backspaces,
        errors: errorCount > 0 ? 1 : 0,
      });
      keystrokeTracker.recordCustomEvent({
        action_type: suspiciousPaste ? "paste" : "edit",
        backspace_count: backspaces,
        error_count: errorCount,
        paste_detected: suspiciousPaste,
        pasted_char_count: suspiciousPaste ? insertedChars : 0,
        pasted_line_count: suspiciousPaste ? insertedLines : 0,
        code_snapshot: suspiciousPaste ? editor.getValue().slice(-2000) : undefined,
      });
    });
  };

  const heatmapLines = useMemo(
    () => Object.values(lineMetrics).sort((a, b) => a.line - b.line),
    [lineMetrics]
  );

  if (!problem) {
    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center">
        <div className="text-sm text-muted-foreground">Loading assessment...</div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden">
      {/* Top Bar */}
      <header className="h-12 bg-bg-surface border-b border-border flex items-center justify-between px-4 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-6 h-6 rounded gradient-btn flex items-center justify-center">
            <Brain className="w-3.5 h-3.5 text-primary-foreground" />
          </div>
          <span className="text-sm font-medium text-foreground">{problem.title}</span>
          <DifficultyBadge difficulty={difficulty as any} />
        </div>
        <div className="flex items-center gap-4 text-sm">
          <div className="flex items-center gap-1 text-gold">
            <Clock className="w-4 h-4" /> {formatTime(timer)}
          </div>
          <div className="flex items-center gap-1 text-rose">
            <AlertCircle className="w-4 h-4" /> Tab switches: {tabSwitchCount}
          </div>
          <div className="flex items-center gap-1 text-gold">
            <Camera className="w-4 h-4" /> Head warnings: {headWarningCount}
          </div>
          <div className="flex items-center gap-1 text-gold">
            <Activity className="w-4 h-4" /> Head moves: {headMovementCount}
          </div>
          <div className="flex items-center gap-1 text-muted-foreground">
            <Activity className="w-4 h-4" /> Focus {liveFocus}%
          </div>
          <GlowButton variant="danger" size="sm" onClick={() => void forceEndExam("Exam ended by candidate")}>End</GlowButton>
        </div>
      </header>

      {guardNotice && (
        <div className="px-4 py-2 text-xs bg-gold/10 text-gold border-b border-gold/20">
          {guardNotice}
        </div>
      )}

      <div className="flex-1 flex min-h-0">
        {/* Problem Panel */}
        <div className="w-[370px] border-r border-border flex flex-col shrink-0">
          <div className="flex-1 overflow-auto p-5 space-y-4">
            <div>
              <h2 className="text-lg font-semibold text-foreground mb-2">{problem.title}</h2>
              <div className="flex gap-2 flex-wrap mb-3">
                <DifficultyBadge difficulty={difficulty as any} />
                {problem.tags.map((t) => (
                  <span key={t} className="px-2 py-0.5 rounded-badge bg-muted text-xs text-muted-foreground">{t}</span>
                ))}
              </div>
              <p className="text-sm text-muted-foreground whitespace-pre-line leading-relaxed">{problem.description}</p>
            </div>
            {problem.examples.map((ex, i) => (
              <div key={i} className="space-y-2">
                <h4 className="text-sm font-medium text-foreground">Example {i + 1}</h4>
                <div className="bg-bg-elevated rounded-lg p-3 font-mono text-xs space-y-1">
                  <div><span className="text-muted-foreground">Input: </span><span className="text-foreground">{ex.input}</span></div>
                  <div><span className="text-muted-foreground">Output: </span><span className="text-teal">{ex.output}</span></div>
                  {ex.explanation && <div><span className="text-muted-foreground">Explanation: </span><span className="text-foreground">{ex.explanation}</span></div>}
                </div>
              </div>
            ))}
            <div>
              <h4 className="text-sm font-medium text-foreground mb-2">Constraints</h4>
              <ul className="space-y-1">
                {problem.constraints.map((c, i) => (
                  <li key={i} className="text-xs text-muted-foreground font-mono flex gap-2"><span className="text-teal">•</span>{c}</li>
                ))}
              </ul>
            </div>
            <div className="text-xs text-muted-foreground">Hidden tests: {problem.hiddenTests}</div>
          </div>
        </div>

        {/* Editor Panel */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="h-10 bg-bg-surface border-b border-border flex items-center justify-between px-3 shrink-0">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="uppercase">{language}</span>
              <Maximize2 className="w-3.5 h-3.5" />
              <span className="text-rose flex items-center gap-1"><PauseCircle className="w-3 h-3" /> Locked exam mode on</span>
              {isAssessmentPaused && <span className="text-gold">Paused by proctoring</span>}
            </div>
          </div>
          <div className="flex-1 min-h-0">
            <Editor
              height="100%"
              language={language}
              value={code}
              onMount={onMount}
              onChange={(v) => setCode(v || "")}
              theme="vs-dark"
              options={{
                minimap: { enabled: false },
                fontSize: 14,
                fontFamily: "JetBrains Mono, monospace",
                readOnly: isAssessmentPaused,
                lineNumbers: "on",
                scrollBeyondLastLine: false,
                automaticLayout: true,
                padding: { top: 12 },
                renderLineHighlight: "all",
              }}
            />
          </div>
          <div className="h-36 border-t border-border bg-bg-surface shrink-0">
            <div className="flex items-center justify-between px-3 h-8 border-b border-border">
              <span className="text-xs font-medium text-muted-foreground">Console</span>
            </div>
            <div className="p-3 font-mono text-xs text-muted-foreground whitespace-pre overflow-auto h-[calc(100%-2rem)]">
              {consoleOutput || "Click 'Run Code' to see output..."}
            </div>
            {runError && (
              <div className="px-3 py-2 text-[11px] text-rose border-t border-border">
                {runError}
              </div>
            )}
          </div>
          <div className="h-12 bg-bg-surface border-t border-border flex items-center justify-between px-4 shrink-0">
            <div />
            <div className="flex items-center gap-3">
              <button
                onClick={handleRun}
                disabled={running || isAssessmentPaused}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-btn bg-bg-hover border border-border text-sm text-foreground hover:bg-bg-elevated transition-colors disabled:opacity-60"
              >
                {running ? <Loader2 className="w-3.5 h-3.5 text-teal animate-spin" /> : <Play className="w-3.5 h-3.5 text-teal" />} Run Code
              </button>
              <GlowButton size="sm" onClick={handleSubmit} disabled={submitting || isAssessmentPaused}>
                {submitting ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Send className="w-3.5 h-3.5 mr-1.5" />} Submit
              </GlowButton>
            </div>
          </div>
        </div>

        {/* Right Panel */}
        <div className="w-[280px] border-l border-border flex flex-col shrink-0">
          <div className="px-4 py-3 border-b border-border flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-mint animate-pulse" />
            <span className="text-sm font-medium text-foreground">Live Analysis</span>
          </div>
          <div className="flex-1 overflow-auto p-4 space-y-4">
            <div className="aspect-video rounded-card border border-teal/20 bg-bg-elevated flex items-center justify-center glow-primary overflow-hidden relative">
              <video
                ref={cameraVideoRef}
                autoPlay
                muted
                playsInline
                className="w-full h-full object-cover scale-x-[-1]"
              />
              <div className="absolute top-2 left-2 px-2 py-1 rounded bg-black/55 text-[10px] text-white uppercase tracking-wide">
                {headDirection === "no-face" ? "face missing" : `head ${headDirection}`}
              </div>
              {!cameraReady && (
                <div className="text-center px-4">
                  <Camera className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                  <span className="text-xs text-muted-foreground block">Starting camera preview...</span>
                  {cameraError && <span className="text-[11px] text-rose block mt-1">{cameraError}</span>}
                </div>
              )}
            </div>
            <div className="text-[11px] text-muted-foreground">
              Proctoring status: {headDirection === "left" || headDirection === "right" ? (
                <span className="text-gold">Side look detected ({headDirection})</span>
              ) : headDirection === "no-face" ? (
                <span className="text-rose">Face not visible</span>
              ) : (
                <span className="text-teal">Centered</span>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2">
              {[
                { icon: Activity, label: "Focus", value: `${liveFocus}%`, color: "text-teal" },
                { icon: Keyboard, label: "Keystrokes", value: keystrokesValue, color: "text-ice" },
                { icon: Clock, label: "Pause", value: isAssessmentPaused ? "YES" : "NO", color: "text-gold" },
                { icon: AlertCircle, label: "Warnings", value: headWarningCount + tabSwitchCount, color: "text-rose" },
              ].map((m) => (
                <div key={m.label} className="glass-card rounded-lg p-3">
                  <m.icon className={cn("w-3.5 h-3.5 mb-1", m.color)} />
                  <div className={`text-lg font-bold ${m.color}`}>{m.value}</div>
                  <div className="text-[10px] text-muted-foreground">{m.label}</div>
                </div>
              ))}
            </div>
            <div className="glass-card rounded-lg p-3">
              <span className="text-xs text-muted-foreground block mb-2">Heatmap</span>
              <div className="space-y-1">
                {heatmapLines.slice(0, 8).map((m) => (
                  <div key={m.line} className="flex items-center gap-2 text-[11px]">
                    <div className="text-muted-foreground w-10">L{m.line}</div>
                    <div className={cn("flex-1 h-2 rounded", heatColor(m))} />
                    <div className="text-muted-foreground w-12 text-right">{struggleScore(m).toFixed(1)}</div>
                  </div>
                ))}
                {heatmapLines.length === 0 && <p className="text-xs text-muted-foreground">Start typing to populate.</p>}
              </div>
            </div>
            <div className="glass-card rounded-lg p-3">
              <span className="text-xs text-muted-foreground block mb-2">Behavior Timeline (last)</span>
              <div className="h-12 flex items-end gap-[2px]">
                {behaviorTimeline.slice(-30).map((p, i) => (
                  <div
                    key={p.timestamp}
                    className="flex-1 rounded-sm bg-teal/70"
                    style={{ height: `${Math.max(8, p.focus)}%`, opacity: 0.4 + i / 60 }}
                  />
                ))}
              </div>
              <div className="text-[10px] text-muted-foreground mt-2">Latest emotion: <span className="text-foreground capitalize">{latestEmotion}</span></div>
            </div>
          </div>
          <div className="px-4 py-3 border-t border-border text-xs text-muted-foreground">
            Anti-cheat: head must stay centered. Exam pauses on non-centered head and resumes only when centered. 3 head warnings close assessment.
          </div>
        </div>
      </div>
    </div>
  );
};

export default Assessment;
