import { create } from "zustand";
import { hasSupabaseEnv, getSupabaseClient } from "@/lib/supabase";

type SupportedLanguage = "python" | "javascript" | "java" | "cpp" | "c" | "go" | "rust";

const LANGUAGE_IDS: Record<SupportedLanguage, number> = {
  python: 71,
  javascript: 63,
  java: 62,
  cpp: 54,
  c: 50,
  go: 60,
  rust: 73,
};

type Example = { input: string; output: string; explanation?: string };

export type Problem = {
  title: string;
  description: string;
  constraints: string[];
  examples: Example[];
  hiddenTests: number;
  tags: string[];
  language?: string;
};

export type LineMetric = {
  line: number;
  timeMs: number;
  edits: number;
  backspaces: number;
  errors: number;
};

export type BehaviorPoint = {
  timestamp: number;
  focus: number; // 0-100
  keystrokes: number;
  backspaces: number;
};

export type SkillScores = {
  problemSolving: number;
  debugging: number;
  focus: number;
  planning: number;
  adaptability: number;
};

export type RunVerdict = {
  passed: boolean | null;
  expected?: string;
  actual?: string;
  sampleInput?: string;
};

export type AssessmentReport = {
  id: string;
  testId: string;
  createdAt: number;
  language: string;
  difficulty: string;
  problemTitle: string;
  skillScores: SkillScores;
  heatmap: LineMetric[];
  behaviorTimeline: BehaviorPoint[];
  insights: { strengths: string[]; weaknesses: string[]; summary: string };
  runVerdict?: RunVerdict;
};

const RUN_VERDICT_STORE_KEY = "mindcode.runVerdictByTestId";
const SESSION_VISUAL_STORE_KEY = "mindcode.sessionVisualsByTestId";

const readRunVerdictStore = (): Record<string, RunVerdict> => {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(RUN_VERDICT_STORE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
};

const writeRunVerdictStore = (next: Record<string, RunVerdict>) => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(RUN_VERDICT_STORE_KEY, JSON.stringify(next));
  } catch {}
};

const persistRunVerdict = (testId: string, verdict?: RunVerdict) => {
  if (!testId || !verdict) return;
  const store = readRunVerdictStore();
  store[testId] = verdict;
  writeRunVerdictStore(store);
};

type SessionVisual = { heatmap: LineMetric[]; behaviorTimeline: BehaviorPoint[] };

const readSessionVisualStore = (): Record<string, SessionVisual> => {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(SESSION_VISUAL_STORE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
};

const writeSessionVisualStore = (next: Record<string, SessionVisual>) => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SESSION_VISUAL_STORE_KEY, JSON.stringify(next));
  } catch {}
};

const persistSessionVisual = (testId: string, visual: SessionVisual) => {
  if (!testId) return;
  const store = readSessionVisualStore();
  store[testId] = visual;
  writeSessionVisualStore(store);
};

type AssessmentState = {
  sessionId: string | null;
  language: string;
  difficulty: string;
  problem: Problem | null;
  code: string;
  lineMetrics: Record<number, LineMetric>;
  behaviorTimeline: BehaviorPoint[];
  reports: AssessmentReport[];
  focusDrops: number;
  fullscreenExits: number;
  runVerdict: RunVerdict | null;
  startAssessment: (language: string, difficulty: string, topic?: string) => Promise<string>;
  setCode: (value: string) => void;
  setRunVerdict: (verdict: RunVerdict | null) => void;
  recordLineMetric: (line: number, delta: Partial<LineMetric>) => void;
  pushBehaviorPoint: (point: BehaviorPoint) => void;
  recordFocusDrop: () => void;
  recordFullscreenExit: () => void;
  completeAssessment: () => Promise<AssessmentReport | null>;
  loadReports: () => Promise<void>;
};

const languageTemplates: Record<string, string> = {
  python: "" +
    "def solve(data):\n" +
    "    # write your solution\n" +
    "    return None\n",
  javascript: "function solve(data) {\n  // write your solution\n  return null;\n}\n",
  java: "class Solution {\n    public Object solve(Object data) {\n        // write your solution\n        return null;\n    }\n}\n",
  cpp: "#include <bits/stdc++.h>\nusing namespace std;\n\nint main(){\n    ios::sync_with_stdio(false);\n    cin.tie(nullptr);\n    // write your solution\n}\n",
  c: "#include <stdio.h>\n\nint main(){\n    // write your solution\n    return 0;\n}\n",
  go: "package main\n\nimport \"fmt\"\n\nfunc main(){\n    // write your solution\n    fmt.Println(\"\")\n}\n",
  rust: "fn main(){\n    // write your solution\n}\n",
};

const randomId = () =>
  (typeof crypto !== "undefined" && "randomUUID" in crypto)
    ? crypto.randomUUID()
    : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = Math.floor(Math.random() * 16);
      const v = c === "x" ? r : ((r & 0x3) | 0x8);
      return v.toString(16);
    });

const problemBank: Record<string, Problem[]> = {
  easy: [
    {
      title: "Balanced Brackets",
      description: "Given a string s containing just the characters '(', ')', '{', '}', '[' and ']', determine if the input string is valid.",
      constraints: ["1 ≤ s.length ≤ 10^4", "s consists of parentheses only"],
      examples: [
        { input: "()[]{}", output: "true" },
        { input: "(]", output: "false" },
      ],
      hiddenTests: 6,
      tags: ["Stack", "Validation"],
    },
    {
      title: "Unique Emails",
      description: "Return the number of different email addresses that actually receive mails when duplicate dots and plus addressing are normalized.",
      constraints: ["1 ≤ emails.length ≤ 100", "Each email has local@domain format"],
      examples: [
        { input: "[\"a@leetcode.com\",\"b@leetcode.com\",\"c@leetcode.com\"]", output: "3" },
      ],
      hiddenTests: 4,
      tags: ["String", "Hash Table"],
    },
  ],
  medium: [
    {
      title: "Sliding Window Maximum",
      description: "Given an integer array nums and an integer k, return the maximum for each window of size k.",
      constraints: ["1 ≤ nums.length ≤ 10^5", "1 ≤ k ≤ nums.length"],
      examples: [
        { input: "nums = [1,3,-1,-3,5,3,6,7], k = 3", output: "[3,3,5,5,6,7]" },
      ],
      hiddenTests: 8,
      tags: ["Deque", "Sliding Window"],
    },
    {
      title: "Course Planner",
      description: "Return true if you can finish all courses given prerequisites; false otherwise (cycle detection).",
      constraints: ["1 ≤ numCourses ≤ 10^4", "0 ≤ prerequisites.length ≤ 10^5"],
      examples: [
        { input: "numCourses = 2, prerequisites = [[1,0]]", output: "true" },
        { input: "numCourses = 2, prerequisites = [[1,0],[0,1]]", output: "false" },
      ],
      hiddenTests: 7,
      tags: ["Graph", "Topo Sort"],
    },
  ],
  hard: [
    {
      title: "Distributed Median Stream",
      description: "Maintain the median of a stream that arrives in shards; return medians after each shard in O(log n).",
      constraints: ["1 ≤ shards.length ≤ 10^5", "Shard size up to 10^4"],
      examples: [
        { input: "[[1,5,9],[2,4],[7,8]]", output: "[3,3.5,6.5]" },
      ],
      hiddenTests: 10,
      tags: ["Heap", "Streaming"],
    },
    {
      title: "Adaptive K-Path",
      description: "Given a weighted directed graph, find k-shortest adaptive paths that tolerate removal of any single edge.",
      constraints: ["2 ≤ n ≤ 500", "0 ≤ m ≤ 5000"],
      examples: [
        { input: "n=4, edges=[[1,2,1],[2,3,2],[1,3,4],[3,4,1]]", output: "[1,2,3,4]" },
      ],
      hiddenTests: 12,
      tags: ["Graph", "Resilience"],
    },
  ],
};

const pickProblem = (difficulty: string) => {
  const pool = problemBank[difficulty as keyof typeof problemBank] || problemBank.medium;
  return pool[Math.floor(Math.random() * pool.length)];
};

const dbDifficulty = (value: string) => {
  if (value === "easy") return "low";
  if (value === "hard") return "high";
  return "medium";
};

const normalizeHeatmap = (input: LineMetric[], minLineCount = 1): LineMetric[] => {
  const byLine = new Map<number, LineMetric>();
  for (const metric of input || []) {
    const line = Math.max(1, Math.round(Number(metric?.line || 0)));
    const existing = byLine.get(line);
    if (existing) {
      existing.timeMs += Number(metric?.timeMs || 0);
      existing.edits += Number(metric?.edits || 0);
      existing.backspaces += Number(metric?.backspaces || 0);
      existing.errors += Number(metric?.errors || 0);
    } else {
      byLine.set(line, {
        line,
        timeMs: Math.max(0, Number(metric?.timeMs || 0)),
        edits: Math.max(0, Number(metric?.edits || 0)),
        backspaces: Math.max(0, Number(metric?.backspaces || 0)),
        errors: Math.max(0, Number(metric?.errors || 0)),
      });
    }
  }

  const maxKnownLine = byLine.size ? Math.max(...Array.from(byLine.keys())) : 0;
  const maxLine = Math.max(1, minLineCount, maxKnownLine);
  const normalized: LineMetric[] = [];
  for (let line = 1; line <= maxLine; line += 1) {
    normalized.push(byLine.get(line) || { line, timeMs: 0, edits: 0, backspaces: 0, errors: 0 });
  }
  return normalized;
};

const SKILL_LABELS: Record<keyof SkillScores, string> = {
  problemSolving: "Problem Solving",
  debugging: "Debugging",
  focus: "Focus",
  planning: "Planning",
  adaptability: "Adaptability",
};

const skillPairs = (scores: SkillScores) => {
  const keys: (keyof SkillScores)[] = ["problemSolving", "debugging", "focus", "planning", "adaptability"];
  return keys.map((key) => [key, Number(scores[key] || 0)] as const);
};

const buildFiveLineInsightSummary = (args: {
  skillScores: SkillScores;
  heatmap: LineMetric[];
  behaviorTimeline: BehaviorPoint[];
  dominantEmotion?: string;
  avgSpeed?: number;
  avgPauseSec?: number;
  logicScore?: number;
  syntaxScore?: number;
}) => {
  const sortedTimeline = [...(args.behaviorTimeline || [])].sort((a, b) => Number(a.timestamp) - Number(b.timestamp));
  const chartData = sortedTimeline.map((point, index) => {
    const prev = sortedTimeline[index - 1];
    return {
      deltaBackspaces: prev ? Number(point.backspaces || 0) - Number(prev.backspaces || 0) : Number(point.backspaces || 0),
      deltaKeys: prev ? Number(point.keystrokes || 0) - Number(prev.keystrokes || 0) : Number(point.keystrokes || 0),
      focus: Number(point.focus || 0),
    };
  });
  const flowZones = chartData.filter((d) => d.focus > 82 && d.deltaKeys > 7).length;
  const idlePauses = chartData.filter((d) => d.deltaKeys < 2).length;
  const avgFocus = Math.round(chartData.reduce((sum, d) => sum + d.focus, 0) / Math.max(1, chartData.length));
  const timelineDurationSec = sortedTimeline.length > 1
    ? Math.round((sortedTimeline[sortedTimeline.length - 1].timestamp - sortedTimeline[0].timestamp) / 1000)
    : 0;
  const heatmapDurationSec = Math.round((args.heatmap || []).reduce((sum, metric) => sum + Number(metric.timeMs || 0), 0) / 1000);
  const durationSec = Math.max(0, timelineDurationSec || heatmapDurationSec);
  const totalEdits = (args.heatmap || []).reduce((sum, metric) => sum + Number(metric.edits || 0), 0);
  const totalBackspaces = (args.heatmap || []).reduce((sum, metric) => sum + Number(metric.backspaces || 0), 0);
  const hardestLine = [...(args.heatmap || [])]
    .sort((a, b) => struggleScore(b) - struggleScore(a))[0];

  const pairs = skillPairs(args.skillScores);
  const bestSkill = [...pairs].sort((a, b) => b[1] - a[1])[0];
  const worstSkill = [...pairs].sort((a, b) => a[1] - b[1])[0];
  const avgSpeed = Number(args.avgSpeed || 0);
  const avgPauseSec = Number(args.avgPauseSec || 0);
  const logicScore = Number.isFinite(Number(args.logicScore)) ? Number(args.logicScore) : null;
  const syntaxScore = Number.isFinite(Number(args.syntaxScore)) ? Number(args.syntaxScore) : null;
  const emotion = String(args.dominantEmotion || "focused").toLowerCase();

  const line1 = `Top skill: ${SKILL_LABELS[bestSkill[0]]} ${Math.round(bestSkill[1])}/100; lowest: ${SKILL_LABELS[worstSkill[0]]} ${Math.round(worstSkill[1])}/100.`;
  const line2 = `Focus avg ${avgFocus}% with ${flowZones} flow zones and ${idlePauses} pauses.`;
  const line3 = `Session ${Math.floor(durationSec / 60)}m ${durationSec % 60}s, ${totalEdits} edits, ${totalBackspaces} backspaces.`;
  const line4 = `Rhythm: ${avgSpeed > 0 ? `${avgSpeed.toFixed(1)} chars/sec` : "speed inferred from timeline"}, ${avgPauseSec > 0 ? `${avgPauseSec.toFixed(1)}s pauses` : "pause data stable"}, tone ${emotion}.`;
  const line5 = `Next focus: improve ${SKILL_LABELS[worstSkill[0]]}${hardestLine ? ` and revisit line ${hardestLine.line}` : ""}${logicScore != null ? ` (logic ${Math.round(logicScore)}/100` : ""}${syntaxScore != null ? `${logicScore != null ? ", " : " ("}syntax ${Math.round(syntaxScore)}/100` : ""}${logicScore != null || syntaxScore != null ? ")" : ""}.`;

  return [line1, line2, line3, line4, line5].join("\n");
};

export const useAssessmentSession = create<AssessmentState>((set, get) => ({
  sessionId: null,
  language: "python",
  difficulty: "medium",
  problem: null,
  code: languageTemplates.python,
  lineMetrics: {},
  behaviorTimeline: [],
  reports: [],
  focusDrops: 0,
  fullscreenExits: 0,
  runVerdict: null,

  startAssessment: async (language: string, difficulty: string, topic?: string) => {
    const sessionId = randomId();
    const easyOnly = String(difficulty || "").toLowerCase() === "easy";
    const fallbackProblem = pickProblem(difficulty);

    // Prime state immediately so route transition never blocks on network.
    set({
      sessionId,
      language,
      difficulty,
      problem: easyOnly ? null : fallbackProblem,
      code: languageTemplates[language] || languageTemplates.python,
      lineMetrics: {},
      behaviorTimeline: [],
      focusDrops: 0,
      fullscreenExits: 0,
      runVerdict: null,
    });

    const persistSession = async (problemForSession: Problem) => {
      if (!hasSupabaseEnv) return;
      try {
        const supa = getSupabaseClient();
        const { data: { user } } = await supa.auth.getUser();
        if (!user) return;

        await supa.from("users").upsert({
          id: user.id,
          email: user.email,
          name: (user.user_metadata as any)?.name ?? null,
        }, { onConflict: "id" });

        await supa
          .from("skill_tests")
          .upsert({
            id: sessionId,
            user_id: user.id,
            language,
            question: problemForSession.description,
            topic: topic || problemForSession.tags?.[0] || "general",
            difficulty: dbDifficulty(difficulty),
            starter_code: languageTemplates[language] || languageTemplates.python,
          }, { onConflict: "id" });
      } catch (err) {
        console.warn("skill test create failed", err);
      }
    };

    // Fire-and-forget AI fetch with a short timeout; if it succeeds we swap in fresher problem
    const fetchAI = async (): Promise<Problem> => {
      const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
      const timeoutMs = easyOnly ? 25000 : 2500;
      const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
      try {
        const resp = await fetch(`${import.meta.env.VITE_AI_API_BASE || import.meta.env.VITE_CODE_RUNNER_URL || "https://mind-code-gilt.vercel.app"}/question`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ language, level: difficulty, topic }),
          signal: controller?.signal,
        });
        if (!resp.ok) throw new Error(`AI question request failed (${resp.status})`);
        const data = await resp.json();
        const q = data.question || {};
        const description = q.problem || q.description || "";
        if (!description) throw new Error("AI question payload missing problem description");

        const problem: Problem = {
          title: q.title || "AI Challenge",
          description,
          constraints: q.constraints || q.constraint || [],
          examples: (q.samples || []).map((s: any) => ({
            input: s.input,
            output: s.output,
            explanation: s.explanation,
          })),
          hiddenTests: 6,
          tags: [q.difficulty || difficulty, q.language || language].filter(Boolean),
          language: q.language || language,
        };
        set({ problem });

        if (!easyOnly && hasSupabaseEnv && sessionId) {
          try {
            const supa = getSupabaseClient();
            await supa
              .from("skill_tests")
              .update({
                language,
                question: problem.description || fallbackProblem?.description,
                topic: topic || problem.tags?.[0] || fallbackProblem?.tags?.[0] || "general",
                difficulty: dbDifficulty(difficulty),
                starter_code: languageTemplates[language] || languageTemplates.python,
              })
              .eq("id", sessionId);
          } catch (err) {
            console.warn("skill test update failed", err);
          }
        }
        return problem;
      } catch (err) {
        console.warn("AI question fetch failed", err);
        throw err;
      } finally {
        if (timer) clearTimeout(timer);
      }
    };

    if (easyOnly) {
      try {
        const aiProblem = await fetchAI();
        await persistSession(aiProblem);
      } catch (_err) {
        set({ sessionId: null, problem: null });
        throw new Error("Easy difficulty requires a Qwen-generated beginner question. Please retry.");
      }
      return sessionId;
    }

    void persistSession(fallbackProblem);
    void fetchAI();
    return sessionId;
  },

  setCode: (value: string) => set({ code: value }),
  setRunVerdict: (verdict: RunVerdict | null) => {
    set({ runVerdict: verdict });
    const sessionId = get().sessionId;
    if (sessionId && verdict) {
      persistRunVerdict(sessionId, verdict);
    }
  },

  recordLineMetric: (line: number, delta: Partial<LineMetric>) => {
    set((state) => {
      const existing = state.lineMetrics[line] || { line, timeMs: 0, edits: 0, backspaces: 0, errors: 0 };
      const updated: LineMetric = {
        ...existing,
        timeMs: existing.timeMs + (delta.timeMs || 0),
        edits: existing.edits + (delta.edits || 0),
        backspaces: existing.backspaces + (delta.backspaces || 0),
        errors: existing.errors + (delta.errors || 0),
      };
      return { lineMetrics: { ...state.lineMetrics, [line]: updated } };
    });
  },

  pushBehaviorPoint: (point: BehaviorPoint) => set((state) => ({ behaviorTimeline: [...state.behaviorTimeline, point] })),

  recordFocusDrop: () => set((state) => ({ focusDrops: state.focusDrops + 1 })),
  recordFullscreenExit: () => set((state) => ({ fullscreenExits: state.fullscreenExits + 1 })),

  completeAssessment: async () => {
    const state = get();
    if (!state.sessionId || !state.problem) return null;
    const sessionRunVerdict = state.runVerdict || undefined;

    const codeLineCount = Math.max(1, String(state.code || "").split("\n").length);
    const heatmap = normalizeHeatmap(Object.values(state.lineMetrics), codeLineCount);
    const avgPause = heatmap.reduce((acc, m) => acc + m.timeMs, 0) / Math.max(1, heatmap.length) / 1000;
    const backspaceSum = heatmap.reduce((acc, m) => acc + m.backspaces, 0);
    const editSum = heatmap.reduce((acc, m) => acc + m.edits, 0);

    const buildFallbackReport = (): AssessmentReport => {
      const skillScores: SkillScores = {
        problemSolving: Math.min(97, 70 + editSum * 1.2),
        debugging: Math.min(97, 72 + backspaceSum * 0.8),
        focus: (() => {
          // Use actual timeline data if available
          if (state.behaviorTimeline.length > 0) {
            const avg = state.behaviorTimeline.reduce((s, p) => s + p.focus, 0) / state.behaviorTimeline.length;
            return Math.round(Math.max(20, Math.min(98, avg)));
          }
          // Fallback: compute from focusDrops and backspaces
          const backspacePenalty = Math.min(40, backspaceSum * 0.5);
          const dropPenalty = state.focusDrops * 15;
          return Math.round(Math.max(20, 85 - backspacePenalty - dropPenalty));
        })(),
        planning: Math.min(96, 68 + heatmap.length * 1.5),
        adaptability: Math.max(50, 88 - state.fullscreenExits * 6),
      };

      return {
        id: state.sessionId,
        testId: state.sessionId,
        createdAt: Date.now(),
        language: state.language,
        difficulty: state.difficulty,
        problemTitle: state.problem.title,
        skillScores,
        heatmap,
        behaviorTimeline: state.behaviorTimeline,
        insights: {
          strengths: skillPairs(skillScores)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 2)
            .map(([key, value]) => `${SKILL_LABELS[key]}: ${Math.round(value)}%`),
          weaknesses: skillPairs(skillScores)
            .sort((a, b) => a[1] - b[1])
            .slice(0, 2)
            .map(([key, value]) => `${SKILL_LABELS[key]}: ${Math.round(value)}%`),
          summary: buildFiveLineInsightSummary({
            skillScores,
            heatmap,
            behaviorTimeline: state.behaviorTimeline,
            avgPauseSec: avgPause,
          }),
        },
        runVerdict: sessionRunVerdict,
      };
    };

    const fallbackReport = buildFallbackReport();
    let finalReport: AssessmentReport = fallbackReport;
    let userId = "";
    const uniqueLines = (items: string[] = []) => {
      const seen = new Set<string>();
      return items
        .map((v) => String(v || "").trim())
        .filter(Boolean)
        .filter((v) => {
          const key = v
            .toLowerCase()
            .replace(/[^\w\s%:/.\-]+/g, "")
            .replace(/\s+/g, " ")
            .trim();
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
    };
    const applyRecommendationInsights = (payload: any) => {
      if (!payload || typeof payload !== "object") return;
      const growthAreas = Array.isArray(payload.growth_areas) ? payload.growth_areas : [];
      const weakAreas = Array.isArray(payload.weak_areas) ? payload.weak_areas : [];
      const compact = (text: string) =>
        String(text || "")
          .replace(/\s+/g, " ")
          .replace(/\s*[-—–]\s*highest score this session\.?$/i, "")
          .replace(/\s*was your strongest dimension\.?$/i, "")
          .trim();
      const strengths = uniqueLines([
        compact(String(payload.strength_note || "")),
        compact(String(payload.strength_insight || "")),
        ...(Array.isArray(finalReport?.insights?.strengths) ? finalReport.insights.strengths : []),
      ]).slice(0, 3);
      const weaknesses = uniqueLines([
        ...growthAreas.map((g: any) => String(g?.fix || g?.why_weak || "")),
        ...weakAreas.map((w: any) => {
          const label = String(w || "");
          if (!label) return "";
          const key = label.toLowerCase();
          const score =
            key.includes("problem") ? finalReport.skillScores.problemSolving :
            key.includes("debug") ? finalReport.skillScores.debugging :
            key.includes("focus") ? finalReport.skillScores.focus :
            key.includes("plan") ? finalReport.skillScores.planning :
            key.includes("flex") ? finalReport.skillScores.adaptability :
            0;
          return score > 0 ? `${label}: ${Math.round(score)}%` : label;
        }),
        ...(Array.isArray(finalReport?.insights?.weaknesses) ? finalReport.insights.weaknesses : []),
      ]).slice(0, 3);
      const payloadMetrics = (payload as any)?.metrics || {};
      const summary = buildFiveLineInsightSummary({
        skillScores: finalReport.skillScores,
        heatmap: finalReport.heatmap,
        behaviorTimeline: finalReport.behaviorTimeline,
        dominantEmotion: String((payload as any)?.dominant_emotion || ""),
        avgSpeed: Number(payloadMetrics.avgTypingSpeed || payloadMetrics.avg_speed || 0),
        avgPauseSec: Number(payloadMetrics.avgPauseSeconds || payloadMetrics.avg_pause_seconds || 0),
        logicScore: Number((payload as any)?.code_review?.logic_score || 0),
        syntaxScore: Number((payload as any)?.code_review?.syntax_score || 0),
      });

      finalReport = {
        ...finalReport,
        insights: {
          strengths: strengths.length ? strengths : (finalReport?.insights?.strengths || []),
          weaknesses: weaknesses.length ? weaknesses : (finalReport?.insights?.weaknesses || []),
          summary,
        },
      };

      set((s) => ({
        reports: s.reports.map((r) =>
          r.id === finalReport.id || r.testId === finalReport.testId
            ? { ...r, insights: finalReport.insights }
            : r
        ),
      }));
    };

    try {
      const supa = hasSupabaseEnv ? getSupabaseClient() : null;
      const { data: { user } } = supa ? await supa.auth.getUser() : { data: { user: null } };
      userId = user?.id || "";
      const endpoint = `${import.meta.env.VITE_AI_API_BASE || import.meta.env.VITE_CODE_RUNNER_URL || "https://mind-code-gilt.vercel.app"}/analysis`;
      const resp = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: user?.id || "",
          test_id: state.sessionId,
          language: state.language,
          question: state.problem.description,
          code: state.code,
        }),
      });

      if (!resp.ok) throw new Error(`analysis endpoint returned ${resp.status}`);

      const data = await resp.json();
      const scores = data.scores || {};
      
      const report: AssessmentReport = {
        id: data.reportId || state.sessionId,
        testId: state.sessionId,
        createdAt: Date.now(),
        language: state.language,
        difficulty: state.difficulty,
        problemTitle: state.problem.title,
        skillScores: {
          problemSolving: Number(scores.problemSolving) || fallbackReport.skillScores.problemSolving,
          debugging: Number(scores.debugging) || fallbackReport.skillScores.debugging,
          focus: Number(scores.focus) || fallbackReport.skillScores.focus,
          planning: Number(scores.planning) || fallbackReport.skillScores.planning,
          adaptability: Number(scores.adaptability) || fallbackReport.skillScores.adaptability,
        },
        heatmap,
        behaviorTimeline: state.behaviorTimeline,
        insights: (() => {
          const tel = data.telemetry || {};
          const avgSpeed = Number(tel.avg_speed || 0);
          const backspaces = Number(tel.backspaces || 0);
          const avgPauseSec = Number(tel.avg_pause_seconds || 0);
          const emotion = data.dominant_emotion || 'focused';
          const logicScore = data.code_review?.logic_score;
          const syntaxScore = data.code_review?.syntax_score;

          // Build strengths from real data
          const strengths: string[] = [];
          const scoreEntries = Object.entries(scores) as [string, number][];
          const bestSkill = scoreEntries.sort((a,b) => Number(b[1]) - Number(a[1]))[0];
          const skillNames: Record<string, string> = {
            problemSolving: 'Problem Solving', debugging: 'Debugging',
            focus: 'Focus', planning: 'Planning', adaptability: 'Adaptability',
          };
          if (bestSkill) {
            strengths.push(`${skillNames[bestSkill[0]] || bestSkill[0]}: ${Math.round(Number(bestSkill[1]))}/100 — highest score this session`);
          }
          if (logicScore != null) {
            strengths.push(`Code logic scored ${Math.round(logicScore)}/100`);
          }
          if (avgSpeed > 3) {
            strengths.push(`Typing speed: ${avgSpeed.toFixed(1)} chars/sec — above average`);
          }
          if (backspaces < 15) {
            strengths.push(`Only ${backspaces} backspaces — clean code approach`);
          }
          if (strengths.length === 0) {
            strengths.push(`Dominant emotion: ${emotion} throughout session`);
          }

          // Build weaknesses from real data
          const weaknesses: string[] = [];
          const worstSkills = scoreEntries.sort((a,b) => Number(a[1]) - Number(b[1])).slice(0, 2);
          worstSkills.forEach(([skill, score]) => {
            if (Number(score) < 75) {
              weaknesses.push(`${skillNames[skill] || skill}: ${Math.round(Number(score))}/100 — needs improvement`);
            }
          });
          if (backspaces > 30) {
            weaknesses.push(`${backspaces} backspaces recorded — high rework detected`);
          }
          if (avgPauseSec > 5) {
            weaknesses.push(`Avg pause of ${avgPauseSec.toFixed(1)}s — consider planning before writing`);
          }
          if (weaknesses.length === 0 && worstSkills.length > 0) {
            weaknesses.push(`${skillNames[worstSkills[0][0]] || worstSkills[0][0]}: ${Math.round(Number(worstSkills[0][1]))}/100`);
          }

          return {
            strengths,
            weaknesses,
            summary: buildFiveLineInsightSummary({
              skillScores: {
                problemSolving: Number(scores.problemSolving) || fallbackReport.skillScores.problemSolving,
                debugging: Number(scores.debugging) || fallbackReport.skillScores.debugging,
                focus: Number(scores.focus) || fallbackReport.skillScores.focus,
                planning: Number(scores.planning) || fallbackReport.skillScores.planning,
                adaptability: Number(scores.adaptability) || fallbackReport.skillScores.adaptability,
              },
              heatmap,
              behaviorTimeline: state.behaviorTimeline,
              dominantEmotion: emotion,
              avgSpeed,
              avgPauseSec,
              logicScore: Number(logicScore),
              syntaxScore: Number(syntaxScore),
            }),
          };
        })(),
        runVerdict: sessionRunVerdict,
      };

      set((s) => ({ reports: [report, ...s.reports].slice(0, 20) }));
      finalReport = report;
    } catch (err) {
      console.warn("backend analysis failed, using local fallback", err);
      set((s) => ({ reports: [fallbackReport, ...s.reports].slice(0, 20) }));
    }

    // Store submission to Supabase via backend
    if (hasSupabaseEnv && !userId) {
      try {
        const supa = getSupabaseClient();
        const { data: { user } } = await supa.auth.getUser();
        userId = user?.id || "";
      } catch (_) {
        userId = "";
      }
    }

    if (userId && state.sessionId && state.code) {
      const submitAPI = import.meta.env.VITE_CODE_RUNNER_URL || "https://mind-code-gilt.vercel.app";
      try {
        const langId = LANGUAGE_IDS[state.language as SupportedLanguage] || 71;
        console.log('[completeAssessment] Storing submission:', { userId, sessionId: state.sessionId, language: state.language });
        const res = await fetch(`${submitAPI}/submit-code`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            user_id: userId,
            test_id: state.sessionId,
            code: state.code,
            language: state.language,
            language_id: langId,
            question_text: state.problem?.description || "",
          }),
        });
        if (!res.ok) {
          const errorData = await res.json().catch(() => ({}));
          console.error('[completeAssessment] Submission storage failed:', { status: res.status, error: errorData });
        } else {
          console.log('[completeAssessment] Submission stored successfully');
        }
      } catch (err) {
        console.error("[completeAssessment] Failed to store submission", err);
      }
    }

    // Persist latest local visuals first so immediate result rendering can use them
    // even before keystroke-derived reconstruction catches up.
    persistSessionVisual(state.sessionId, {
      heatmap: heatmap,
      behaviorTimeline: state.behaviorTimeline,
    });

    // Persist report/recommendation from real stored telemetry before refreshing history.
    if (userId && state.sessionId) {
      const API = import.meta.env.VITE_CODE_RUNNER_URL || "https://mind-code-gilt.vercel.app";
      try {
        await fetch(`${API}/generate-report`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ user_id: userId, test_id: state.sessionId }),
        });
      } catch (_) {}

      try {
        const recResp = await fetch(`${API}/generate-recommendations`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            user_id: userId,
            test_id: state.sessionId,
            scores: {
              problemSolving: finalReport.skillScores.problemSolving,
              debugging: finalReport.skillScores.debugging,
              focus: finalReport.skillScores.focus,
              planning: finalReport.skillScores.planning,
              flexibility: finalReport.skillScores.adaptability,
            },
            language: state.language,
          }),
        });
        if (recResp.ok) {
          const recData = await recResp.json().catch(() => null);
          applyRecommendationInsights(recData);
        }
      } catch (_) {}

      await get().loadReports().catch(() => {});
      const refreshed = get().reports.find((r) => r.testId === state.sessionId || r.id === state.sessionId);
      if (refreshed) {
        finalReport = {
          ...refreshed,
          runVerdict: refreshed.runVerdict || sessionRunVerdict,
        };
      }
    }

    persistRunVerdict(state.sessionId, sessionRunVerdict || finalReport.runVerdict);

    return finalReport;
  },

  loadReports: async () => {
    if (!hasSupabaseEnv) return;
    try {
      const supa = getSupabaseClient();
      const { data: { user } } = await supa.auth.getUser();
      if (!user) return;
      const { data, error } = await supa
        .from("reports")
        .select("id, created_at, test_id, problem_breakdown_score, debugging_score, focus_score, planning_score, flexibility_score, heatmap_data, summary, skill_tests(language,difficulty,question,topic)")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      const uniqueByTestId = new Map<string, any>();
      for (const row of data || []) {
        const key = String((row as any).test_id || (row as any).id || "");
        if (!key) continue;
        if (!uniqueByTestId.has(key)) uniqueByTestId.set(key, row);
      }

      const uniqueTestIds = Array.from(uniqueByTestId.keys());
      const { data: recommendationRows } = uniqueTestIds.length
        ? await supa
          .from("recommendations")
          .select("test_id, created_at, weak_areas, ai_feedback")
          .eq("user_id", user.id)
          .in("test_id", uniqueTestIds)
          .order("created_at", { ascending: false })
        : { data: [] as any[] };

      const latestRecommendationByTestId = new Map<string, any>();
      for (const rec of recommendationRows || []) {
        const key = String((rec as any)?.test_id || "");
        if (!key) continue;
        if (!latestRecommendationByTestId.has(key)) {
          latestRecommendationByTestId.set(key, rec);
        }
      }

      const { data: submissionRows } = uniqueTestIds.length
        ? await supa
          .from("submissions")
          .select("test_id, passed, output, error, created_at")
          .eq("user_id", user.id)
          .in("test_id", uniqueTestIds)
          .order("created_at", { ascending: false })
        : { data: [] as any[] };

      const latestSubmissionByTestId = new Map<string, any>();
      for (const sub of submissionRows || []) {
        const key = String((sub as any)?.test_id || "");
        if (!key) continue;
        if (!latestSubmissionByTestId.has(key)) {
          latestSubmissionByTestId.set(key, sub);
        }
      }

      const { data: keystrokeRows } = uniqueTestIds.length
        ? await supa
          .from("keystroke_logs")
          .select(`
            test_id, timestamp, line_number, line_time_ms, pause_duration,
            pause_duration_ms, backspace_count, error_count, focus_level,
            keystroke_count, action_type, code_snapshot
          `)
          .eq("user_id", user.id)
          .in("test_id", uniqueTestIds)
          .order("timestamp", { ascending: true })
        : { data: [] as any[] };

      const groupedKeystrokes = new Map<string, any[]>();
      for (const row of keystrokeRows || []) {
        const key = String((row as any)?.test_id || "");
        if (!key) continue;
        const bucket = groupedKeystrokes.get(key) || [];
        bucket.push(row);
        groupedKeystrokes.set(key, bucket);
      }

      const derivedVisualByTestId = new Map<string, SessionVisual>();
      for (const [testId, rows] of groupedKeystrokes.entries()) {
        const lineAgg = new Map<number, LineMetric>();
        const timeline: BehaviorPoint[] = [];
        const rawTimeline: BehaviorPoint[] = [];
        let prevCumulativeKeystrokes = 0;
        let prevCodeLength = 0;
        let latestSnapshot = "";
        const bucketMap = new Map<number, { keys: number; backs: number; focusSum: number; focusCount: number }>();
        const firstTsRaw = rows[0]?.timestamp ? new Date(rows[0].timestamp).getTime() : Date.now();
        const firstTs = Number.isFinite(firstTsRaw) ? firstTsRaw : Date.now();
        let lastFocus = 70;
        let runningRawKeys = 0;
        let runningRawBacks = 0;

        for (const row of rows) {
          const tsRaw = row?.timestamp ? new Date(row.timestamp).getTime() : Date.now();
          const ts = Number.isFinite(tsRaw) ? tsRaw : firstTs;
          const rawFocus = Number(row?.focus_level || 0);
          const focusNormalized = rawFocus > 1 ? rawFocus : rawFocus * 100;
          const currentKeystrokeCount = Number(row?.keystroke_count || 0);
          const backspaces = Number(row?.backspace_count || 0);
          const pauseMs = Number(row?.line_time_ms || row?.pause_duration_ms || row?.pause_duration || 0);
          const codeLength = Math.max(0, Number(row?.code_length || 0));
          const codeLengthDelta = codeLength > 0 ? (codeLength - prevCodeLength) : 0;
          if (codeLength > 0) prevCodeLength = codeLength;
          const line = Number.isFinite(Number(row?.line_number)) ? Number(row?.line_number) : null;
          const actionType = String(row?.action_type || "");
          const isSummary = actionType === "behavior_block_summary";
          const cumulativeDelta = Math.max(0, currentKeystrokeCount - prevCumulativeKeystrokes);
          if (!isSummary && currentKeystrokeCount > 0) {
            prevCumulativeKeystrokes = Math.max(prevCumulativeKeystrokes, currentKeystrokeCount);
          }
          const editCount = cumulativeDelta > 0
            ? cumulativeDelta
            : (actionType === "insert" || actionType === "delete" || actionType === "paste" ? 1 : 0);

          let timelineKeyIncrement = 0;
          if (isSummary) {
            timelineKeyIncrement = Math.max(0, currentKeystrokeCount);
          } else if (cumulativeDelta > 0) {
            timelineKeyIncrement = cumulativeDelta;
          } else {
            const pastedCharCount = Number(row?.paste_char_count || row?.pasted_char_count || 0);
            if (actionType === "paste" && pastedCharCount > 0) {
              timelineKeyIncrement = pastedCharCount;
            } else if (actionType === "paste" && codeLengthDelta > 0) {
              timelineKeyIncrement = Math.max(3, codeLengthDelta);
            } else if (actionType === "insert" || actionType === "delete") {
              if (codeLengthDelta > 0 && actionType === "insert") {
                timelineKeyIncrement = Math.max(1, codeLengthDelta);
              } else if (codeLengthDelta < 0 && actionType === "delete") {
                timelineKeyIncrement = Math.max(1, Math.abs(codeLengthDelta));
              } else {
                timelineKeyIncrement = Math.max(1, editCount);
              }
            } else if (codeLengthDelta > 0) {
              timelineKeyIncrement = Math.max(1, codeLengthDelta);
            } else {
              timelineKeyIncrement = Math.max(0, editCount);
            }
          }

          // Synthesize interval focus from typing/backspace/pause activity.
          let syntheticFocus = 50;
          if (timelineKeyIncrement === 0 && backspaces === 0) {
            syntheticFocus = 35;
          } else if (timelineKeyIncrement > 15) {
            syntheticFocus = 88 + Math.min(10, timelineKeyIncrement - 15);
          } else if (timelineKeyIncrement > 8) {
            syntheticFocus = 70 + timelineKeyIncrement * 1.2;
          } else if (timelineKeyIncrement > 0) {
            syntheticFocus = 45 + timelineKeyIncrement * 3;
          }

          if (backspaces > 8) syntheticFocus -= 18;
          else if (backspaces > 4) syntheticFocus -= 10;
          else if (backspaces > 1) syntheticFocus -= 4;

          if (pauseMs > 3500) syntheticFocus -= 10;
          else if (pauseMs > 1500) syntheticFocus -= 5;

          const syntheticClamped = Math.max(10, Math.min(98, Math.round(syntheticFocus)));

          // When explicit focus exists (often cumulative/stable), blend with interval signal
          // so the resulting chart still reflects local behavioral fluctuation.
          let pointFocus = syntheticClamped;
          if (focusNormalized > 0) {
            const explicit = Math.max(0, Math.min(100, focusNormalized));
            pointFocus = Math.max(10, Math.min(98, Math.round(explicit * 0.55 + syntheticClamped * 0.45)));
          }
          lastFocus = pointFocus;

          const bucketIndex = Math.max(0, Math.floor((ts - firstTs) / 5000));
          const bucket = bucketMap.get(bucketIndex) || { keys: 0, backs: 0, focusSum: 0, focusCount: 0 };
          bucket.keys += Math.max(0, timelineKeyIncrement);
          bucket.backs += Math.max(0, backspaces);
          bucket.focusSum += pointFocus;
          bucket.focusCount += 1;
          bucketMap.set(bucketIndex, bucket);

          runningRawKeys += Math.max(0, timelineKeyIncrement);
          runningRawBacks += Math.max(0, backspaces);
          rawTimeline.push({
            timestamp: ts,
            focus: pointFocus,
            keystrokes: runningRawKeys,
            backspaces: runningRawBacks,
          });

          if (line && line > 0) {
            const existing = lineAgg.get(line) || {
              line,
              timeMs: 0,
              edits: 0,
              backspaces: 0,
              errors: 0,
            };
            existing.timeMs += Math.max(0, pauseMs);
            existing.edits += Math.max(0, editCount);
            existing.backspaces += Math.max(0, backspaces);
            existing.errors += Math.max(0, Number(row?.error_count || 0));
            lineAgg.set(line, existing);
          }

          if (typeof row?.code_snapshot === "string" && row.code_snapshot.length > 0) {
            latestSnapshot = row.code_snapshot;
          }
        }

        const maxBucket = bucketMap.size ? Math.max(...Array.from(bucketMap.keys())) : -1;
        let cumulativeKeys = 0;
        let cumulativeBacks = 0;
        let carryFocus = lastFocus;
        for (let i = 0; i <= maxBucket; i += 1) {
          const bucket = bucketMap.get(i) || { keys: 0, backs: 0, focusSum: 0, focusCount: 0 };
          cumulativeKeys += bucket.keys;
          cumulativeBacks += bucket.backs;
          const focus = bucket.focusCount
            ? Math.round(bucket.focusSum / bucket.focusCount)
            : Math.max(10, Math.round(carryFocus - 4));
          carryFocus = focus;
          timeline.push({
            timestamp: firstTs + i * 5000,
            focus: Math.max(0, Math.min(100, focus)),
            keystrokes: cumulativeKeys,
            backspaces: cumulativeBacks,
          });
        }
        if (timeline.length === 1) {
          timeline.push({
            ...timeline[0],
            timestamp: timeline[0].timestamp + 5000,
          });
        }

        const dedupedRawTimeline = rawTimeline
          .sort((a, b) => Number(a.timestamp) - Number(b.timestamp))
          .filter((point, idx, arr) => idx === 0 || Number(point.timestamp) !== Number(arr[idx - 1].timestamp));
        const sampledRawTimeline = dedupedRawTimeline.filter((_, idx, arr) => {
          if (arr.length <= 250) return true;
          const stride = Math.ceil(arr.length / 250);
          return idx % stride === 0 || idx === arr.length - 1;
        });
        const bucketKeyDelta = timeline.length > 1
          ? Number(timeline[timeline.length - 1].keystrokes || 0) - Number(timeline[0].keystrokes || 0)
          : 0;
        const rawKeyDelta = sampledRawTimeline.length > 1
          ? Number(sampledRawTimeline[sampledRawTimeline.length - 1].keystrokes || 0) - Number(sampledRawTimeline[0].keystrokes || 0)
          : 0;
        const shouldUseRawTimeline = sampledRawTimeline.length > 2 && (rawKeyDelta > bucketKeyDelta || bucketKeyDelta <= 0);

        const snapshotLineCount = latestSnapshot ? latestSnapshot.split("\n").length : 0;
        const maxEditedLine = lineAgg.size ? Math.max(...Array.from(lineAgg.keys())) : 0;
        const maxLine = Math.max(maxEditedLine, snapshotLineCount, 1);
        const derivedHeatmap = normalizeHeatmap(Array.from(lineAgg.values()), maxLine);

        derivedVisualByTestId.set(testId, {
          heatmap: derivedHeatmap,
          behaviorTimeline: shouldUseRawTimeline ? sampledRawTimeline : timeline,
        });
      }

      const verdictStore = readRunVerdictStore();
      const visualStore = readSessionVisualStore();
      const mapped = Array.from(uniqueByTestId.values()).map((r) => {
        const testIdKey = String((r as any).test_id || (r as any).id || "");
        const testMeta: any = Array.isArray((r as any).skill_tests)
          ? (r as any).skill_tests[0]
          : (r as any).skill_tests;
        const storedVerdict = verdictStore[testIdKey];
        const latestSubmission = latestSubmissionByTestId.get(testIdKey);
        const submissionActual = latestSubmission
          ? String((latestSubmission.output || latestSubmission.error || "")).trim()
          : "";
        const submissionVerdict: RunVerdict | undefined = latestSubmission
          ? {
            passed: typeof latestSubmission.passed === "boolean" ? latestSubmission.passed : null,
            expected: undefined,
            actual: submissionActual || undefined,
            sampleInput: undefined,
          }
          : undefined;
        const runVerdict = storedVerdict || submissionVerdict;
        const savedVisual = visualStore[testIdKey];
        const recommendation = latestRecommendationByTestId.get(testIdKey);
        const rawSummary = String(r.summary || "");
        const summaryParts = rawSummary.split(" | ");
        const maybeTitle = summaryParts.length > 1 ? summaryParts[0] : "";
        const dbDifficulty = String(testMeta?.difficulty || "").toLowerCase();
        const uiDifficulty = dbDifficulty === "low"
          ? "easy"
          : dbDifficulty === "high"
            ? "hard"
            : dbDifficulty || "medium";
        const scores = {
          problemSolving: Number(r.problem_breakdown_score) || 0,
          debugging: Number(r.debugging_score) || 0,
          focus: Number(r.focus_score) || 0,
          planning: Number(r.planning_score) || 0,
          adaptability: Number(r.flexibility_score) || 0,
        };

        const parseAiFeedback = (value: unknown) => {
          if (!value) return null as any;
          if (typeof value === "string") {
            try {
              const parsed = JSON.parse(value);
              return parsed && typeof parsed === "object" ? parsed : null;
            } catch {
              return { personalized_feedback: value };
            }
          }
          return typeof value === "object" ? value : null;
        };
        const normalizeUnique = (items: string[] = []) => {
          const seen = new Set<string>();
          return items
            .map((v) => String(v || "").replace(/\s+/g, " ").trim())
            .filter(Boolean)
            .filter((v) => {
              const key = v
                .toLowerCase()
                .replace(/[^\w\s%:/.\-]+/g, "")
                .replace(/\s+/g, " ")
                .trim();
              if (seen.has(key)) return false;
              seen.add(key);
              return true;
            });
        };
        const aiFeedback = parseAiFeedback((recommendation as any)?.ai_feedback);
        const weakAreas = Array.isArray((recommendation as any)?.weak_areas)
          ? (recommendation as any).weak_areas.map((w: any) => String(w))
          : [];
        const aiGrowthAreas = Array.isArray((aiFeedback as any)?.growth_areas) ? (aiFeedback as any).growth_areas : [];

        const rawHeatmap = Array.isArray((r as any).heatmap_data) ? (r as any).heatmap_data : [];
        const dbHeatmap: LineMetric[] = rawHeatmap.map((h: any, idx: number) => {
          const line = Number(h?.line ?? idx + 1);
          const weight = Number(h?.weight ?? 0);
          return {
            line,
            timeMs: Number(h?.timeMs ?? (weight > 0 ? weight * 900 : 300)),
            edits: Number(h?.edits ?? Math.max(1, Math.round(weight + 1))),
            backspaces: Number(h?.backspaces ?? Math.max(0, Math.round(weight * 0.7))),
            errors: Number(h?.errors ?? (weight > 2 ? 1 : 0)),
          };
        });
        const derivedVisual = derivedVisualByTestId.get(testIdKey);
        const countActiveHeatLines = (rows: LineMetric[] = []) =>
          rows.filter((row) => (row.edits || 0) > 0 || (row.backspaces || 0) > 0 || (row.timeMs || 0) > 0 || (row.errors || 0) > 0).length;
        const normalizeTimelineSource = (rows: BehaviorPoint[] = []) =>
          [...rows]
            .filter((row) => Number.isFinite(Number(row?.timestamp)))
            .sort((a, b) => Number(a.timestamp) - Number(b.timestamp));
        const hasMeaningfulTimeline = (rows: BehaviorPoint[] = []) => {
          if (rows.length < 2) return false;
          const first = rows[0];
          const last = rows[rows.length - 1];
          const keyDelta = Number(last?.keystrokes || 0) - Number(first?.keystrokes || 0);
          const backDelta = Number(last?.backspaces || 0) - Number(first?.backspaces || 0);
          const uniqueFocus = new Set(rows.map((row) => Math.round(Number(row?.focus || 0)))).size;
          return keyDelta > 0 || backDelta > 0 || uniqueFocus > 1 || rows.length >= 4;
        };

        const savedHeatmap = Array.isArray(savedVisual?.heatmap) ? savedVisual.heatmap : [];
        const derivedHeatmap = Array.isArray(derivedVisual?.heatmap) ? derivedVisual.heatmap : [];
        const dbHeatmapNormalized = dbHeatmap;
        const savedActiveLines = countActiveHeatLines(savedHeatmap);
        const derivedActiveLines = countActiveHeatLines(derivedHeatmap);
        const dbActiveLines = countActiveHeatLines(dbHeatmapNormalized);
        const heatmapSource =
          derivedActiveLines > savedActiveLines
            ? derivedHeatmap
            : savedActiveLines > 0
              ? savedHeatmap
              : derivedActiveLines > 0
                ? derivedHeatmap
                : dbActiveLines > 0
                  ? dbHeatmapNormalized
                  : (savedHeatmap.length ? savedHeatmap : (derivedHeatmap.length ? derivedHeatmap : dbHeatmapNormalized));
        const heatmap = normalizeHeatmap(heatmapSource, 1);

        const savedTimeline = normalizeTimelineSource(savedVisual?.behaviorTimeline || []);
        const derivedTimeline = normalizeTimelineSource(derivedVisual?.behaviorTimeline || []);
        const timelineVariationScore = (rows: BehaviorPoint[] = []) => {
          if (rows.length < 2) return 0;
          const focusValues = rows.map((row) => Number(row.focus || 0));
          const uniqueFocus = new Set(focusValues.map((v) => Math.round(v))).size;
          const minFocus = Math.min(...focusValues);
          const maxFocus = Math.max(...focusValues);
          return (maxFocus - minFocus) + uniqueFocus * 0.5;
        };
        const derivedMeaningful = hasMeaningfulTimeline(derivedTimeline);
        const savedMeaningful = hasMeaningfulTimeline(savedTimeline);
        const behaviorTimeline: BehaviorPoint[] =
          derivedMeaningful && savedMeaningful
            ? (timelineVariationScore(savedTimeline) > timelineVariationScore(derivedTimeline) ? savedTimeline : derivedTimeline)
            : derivedMeaningful
              ? derivedTimeline
              : savedMeaningful
                ? savedTimeline
                : (derivedTimeline.length ? derivedTimeline : savedTimeline);

        const strengthPairs = [
          ["Problem solving", scores.problemSolving],
          ["Debugging", scores.debugging],
          ["Focus", scores.focus],
          ["Planning", scores.planning],
          ["Adaptability", scores.adaptability],
        ] as const;
        const strengths = strengthPairs
          .filter(([, v]) => v >= 80)
          .sort((a, b) => Number(b[1]) - Number(a[1]))
          .slice(0, 3)
          .map(([k, v]) => `${k}: ${Math.round(v)}%`);
        const weaknesses = strengthPairs
          .filter(([, v]) => v < 80)
          .sort((a, b) => Number(a[1]) - Number(b[1]))
          .slice(0, 3)
          .map(([k, v]) => `${k}: ${Math.round(v)}%`);

        const weakAreaScore = (area: string) => {
          const key = String(area || "").toLowerCase();
          if (key.includes("problem")) return scores.problemSolving;
          if (key.includes("debug")) return scores.debugging;
          if (key.includes("focus")) return scores.focus;
          if (key.includes("plan")) return scores.planning;
          if (key.includes("flex")) return scores.adaptability;
          return 0;
        };

        const aiWeaknesses = normalizeUnique([
          ...aiGrowthAreas.map((g: any) => String(g?.fix || g?.why_weak || "")),
          ...weakAreas.slice(0, 3).map((w: string) => `${w}: ${Math.round(weakAreaScore(w))}%`),
        ]).slice(0, 3);
        const aiStrengthsFromNarrative = normalizeUnique([
          typeof aiFeedback?.strength_note === "string" ? aiFeedback.strength_note : "",
          typeof aiFeedback?.strength_insight === "string" ? aiFeedback.strength_insight : "",
        ]).slice(0, 3);
        const aiGrowthFromNarrative = normalizeUnique([
          typeof aiFeedback?.growth_edge === "string" ? aiFeedback.growth_edge : "",
          typeof aiFeedback?.personalized_feedback === "string" ? aiFeedback.personalized_feedback : "",
        ]).slice(0, 3);

        const aiMetrics = (aiFeedback as any)?.metrics || {};
        const summaryText = buildFiveLineInsightSummary({
          skillScores: scores,
          heatmap,
          behaviorTimeline,
          dominantEmotion: String((aiFeedback as any)?.dominant_emotion || ""),
          avgSpeed: Number(aiMetrics.avgTypingSpeed || aiMetrics.avg_speed || 0),
          avgPauseSec: Number(aiMetrics.avgPauseSeconds || aiMetrics.avg_pause_seconds || 0),
          logicScore: Number((aiFeedback as any)?.code_review?.logic_score || 0),
          syntaxScore: Number((aiFeedback as any)?.code_review?.syntax_score || 0),
        });

        return {
        id: r.id,
        testId: String((r as any).test_id || r.id),
        createdAt: new Date(r.created_at || Date.now()).getTime(),
        language: testMeta?.language || "python",
        difficulty: uiDifficulty,
        problemTitle: maybeTitle || testMeta?.topic || testMeta?.question?.slice(0, 40) || "Assessment",
        skillScores: scores,
        heatmap,
        behaviorTimeline,
        insights: {
          strengths: aiStrengthsFromNarrative.length
            ? aiStrengthsFromNarrative
            : (strengths.length ? strengths : ["Baseline consistency maintained across session"]),
          weaknesses: aiWeaknesses.length
            ? aiWeaknesses
            : (aiGrowthFromNarrative.length
              ? aiGrowthFromNarrative
              : (weaknesses.length ? weaknesses : ["No major weak signal detected in this attempt"])),
          summary: summaryText,
        },
        runVerdict,
      } as AssessmentReport;
      });
      set({ reports: mapped });
    } catch (err) {
      console.warn("supabase load reports failed", err);
    }
  },
}));

export const struggleScore = (metric: LineMetric) => {
  const pauseSeconds = metric.timeMs / 1000;
  return pauseSeconds * 0.4 + metric.backspaces * 0.3 + metric.edits * 0.2 + metric.errors * 0.1;
};

export const heatColor = (metric: LineMetric) => {
  const score = struggleScore(metric);
  if (score < 2) return "bg-emerald-500/50";
  if (score < 4) return "bg-amber-400/50";
  return "bg-rose-500/60";
};

export const formatDate = (ts: number) => new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
}).format(ts);
