import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  ArrowRight,
  Brain,
  CheckCircle,
  Loader2,
  Minus,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import Navbar from "@/components/Navbar";
import { useAssessmentSession } from "@/hooks/useAssessmentSession";
import { getSupabaseClient, hasSupabaseEnv } from "@/lib/supabase";

type GrowthArea = {
  skill: string;
  score: number;
  why_weak: string;
  fix: string;
  practice_topic: string;
};

type FullRecommendation = {
  headline: string;
  behavioral_story: string;
  weak_areas: string[];
  strength_note: string;
  growth_areas: GrowthArea[];
  recommended_topics: string[];
  suggested_questions: {
    title: string;
    difficulty: string;
    tags: string[];
    targets_skill: string;
  }[];
  personalized_feedback: string;
  study_plan: string[];
};

type SessionContext = {
  scores: Record<string, number>;
  language: string;
  topic: string;
  difficulty: string;
  totalAssessments: number;
  trend: Record<string, number> | null;
};

type SkillTestMeta = {
  language?: string | null;
  topic?: string | null;
  difficulty?: string | null;
};

type ReportRow = {
  id: string;
  test_id: string;
  created_at: string;
  problem_breakdown_score: number | null;
  debugging_score: number | null;
  focus_score: number | null;
  planning_score: number | null;
  flexibility_score: number | null;
  summary?: string | null;
  skill_tests?: SkillTestMeta | SkillTestMeta[] | null;
};

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const toSafeNumber = (value: unknown) => {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
};

const labelForSkill = (skill: string) => {
  if (skill === "problemSolving") return "Problem Solving";
  if (skill === "debugging") return "Debugging";
  if (skill === "focus") return "Focus";
  if (skill === "planning") return "Planning";
  if (skill === "adaptability") return "Adaptability";
  if (skill === "flexibility") return "Adaptability";
  return skill;
};

const normalizeSkillTests = (skillTests: ReportRow["skill_tests"]): SkillTestMeta => {
  if (!skillTests) return {};
  if (Array.isArray(skillTests)) return skillTests[0] || {};
  return skillTests;
};

const scoreColor = (score: number) => {
  if (score >= 75) return "#14b8a6";
  if (score >= 55) return "#f59e0b";
  return "#ef4444";
};

export default function AIRecommendations() {
  const navigate = useNavigate();
  const { startAssessment } = useAssessmentSession();

  const [loading, setLoading] = useState(true);
  const [loadStep, setLoadStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [noReports, setNoReports] = useState(false);

  const [context, setContext] = useState<SessionContext | null>(null);
  const [recs, setRecs] = useState<FullRecommendation | null>(null);

  const mapRecommendationPayload = (data: any): FullRecommendation => ({
    headline: String(data?.headline || "AI insights ready"),
    behavioral_story: String(data?.behavioral_story || ""),
    weak_areas: Array.isArray(data?.weak_areas) ? data.weak_areas.map(String) : [],
    strength_note: String(data?.strength_note || data?.strength_insight || ""),
    growth_areas: Array.isArray(data?.growth_areas)
      ? data.growth_areas.map((item: any) => ({
          skill: String(item?.skill || ""),
          score: Math.round(toSafeNumber(item?.score)),
          why_weak: String(item?.why_weak || ""),
          fix: String(item?.fix || ""),
          practice_topic: String(item?.practice_topic || ""),
        }))
      : [],
    recommended_topics: Array.isArray(data?.recommended_topics)
      ? data.recommended_topics.map(String)
      : [],
    suggested_questions: Array.isArray(data?.suggested_questions)
      ? data.suggested_questions.map((q: any) => ({
          title: String(q?.title || "Practice Problem"),
          difficulty: String(q?.difficulty || "medium"),
          tags: Array.isArray(q?.tags) ? q.tags.map(String) : [],
          targets_skill: String(q?.targets_skill || q?.target_skill || "problemSolving"),
        }))
      : [],
    personalized_feedback: String(data?.personalized_feedback || ""),
    study_plan: Array.isArray(data?.study_plan) ? data.study_plan.map(String) : [],
  });

  const load = useCallback(async () => {
    setLoading(true);
    setLoadStep(1);
    setError(null);
    setNoReports(false);
    setContext(null);
    setRecs(null);

    let stepTimer: ReturnType<typeof setTimeout> | null = null;

    try {
      if (!hasSupabaseEnv) {
        throw new Error("Supabase environment is not configured.");
      }

      const supabase = getSupabaseClient();
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError) throw userError;
      if (!user?.id) throw new Error("You need to be logged in to view recommendations.");

      const userId = user.id;

      stepTimer = setTimeout(() => {
        setLoadStep(2);
      }, 800);

      const { data: reports, error: reportsError } = await supabase
        .from("reports")
        .select(`
          id,
          test_id,
          created_at,
          problem_breakdown_score,
          debugging_score,
          focus_score,
          planning_score,
          flexibility_score,
          summary,
          skill_tests (language, topic, difficulty)
        `)
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(10);

      if (reportsError) throw reportsError;

      const typedReports = (reports || []) as ReportRow[];
      const latestReport = typedReports[0];
      const prevReport = typedReports[1];

      if (!latestReport) {
        setNoReports(true);
        return;
      }

      if (stepTimer) {
        await delay(800);
      }

      const trend = prevReport
        ? {
            problemSolving: toSafeNumber(latestReport.problem_breakdown_score) - toSafeNumber(prevReport.problem_breakdown_score),
            debugging: toSafeNumber(latestReport.debugging_score) - toSafeNumber(prevReport.debugging_score),
            focus: toSafeNumber(latestReport.focus_score) - toSafeNumber(prevReport.focus_score),
            planning: toSafeNumber(latestReport.planning_score) - toSafeNumber(prevReport.planning_score),
            adaptability: toSafeNumber(latestReport.flexibility_score) - toSafeNumber(prevReport.flexibility_score),
          }
        : null;

      const testMeta = normalizeSkillTests(latestReport.skill_tests);
      const scores = {
        problemSolving: toSafeNumber(latestReport.problem_breakdown_score),
        debugging: toSafeNumber(latestReport.debugging_score),
        focus: toSafeNumber(latestReport.focus_score),
        planning: toSafeNumber(latestReport.planning_score),
        adaptability: toSafeNumber(latestReport.flexibility_score),
      };

      const { data: submissions } = await supabase
        .from("submissions")
        .select("passed, error")
        .eq("user_id", userId)
        .eq("test_id", latestReport.test_id);

      const submissionErrors = (submissions || [])
        .filter((s: any) => s?.error)
        .map((s: any) => String(s.error))
        .slice(0, 3);

      const API =
        import.meta.env.VITE_AI_API_BASE ||
        import.meta.env.VITE_CODE_RUNNER_URL ||
        "https://mind-code-gilt.vercel.app";

      setLoadStep(3);

      setContext({
        scores,
        language: testMeta?.language || "python",
        topic: testMeta?.topic || "algorithms",
        difficulty: testMeta?.difficulty || "medium",
        totalAssessments: typedReports.length,
        trend,
      });

      // Prefer persisted recommendation for this exact assessment.
      const { data: existingRec } = await supabase
        .from("recommendations")
        .select("ai_feedback, weak_areas, recommended_topics, suggested_questions, study_plan, created_at")
        .eq("user_id", userId)
        .eq("test_id", latestReport.test_id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      let resolvedPayload: any = null;
      if (existingRec?.ai_feedback) {
        try {
          resolvedPayload = JSON.parse(String(existingRec.ai_feedback));
        } catch {
          resolvedPayload = null;
        }
      }

      if (!resolvedPayload || !resolvedPayload.headline) {
        const response = await fetch(`${API}/generate-recommendations`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            user_id: userId,
            test_id: latestReport.test_id,
            scores: {
              problemSolving: scores.problemSolving,
              debugging: scores.debugging,
              focus: scores.focus,
              planning: scores.planning,
              flexibility: scores.adaptability,
            },
            submission_errors: submissionErrors,
            language: testMeta?.language || undefined,
            topic: testMeta?.topic || undefined,
          }),
        });
        const generated = await response.json();
        if (!response.ok) {
          throw new Error(generated?.error || "Failed to generate recommendations");
        }
        resolvedPayload = generated;
      }

      setRecs(mapRecommendationPayload(resolvedPayload));
    } catch (err: any) {
      setError(err?.message || "Failed to load recommendations");
    } finally {
      if (stepTimer) clearTimeout(stepTimer);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const scoreRows = useMemo(() => {
    const scores = context?.scores || {};
    return [
      { key: "problemSolving", label: "Problem Solving", value: Math.round(toSafeNumber(scores.problemSolving)) },
      { key: "debugging", label: "Debugging", value: Math.round(toSafeNumber(scores.debugging)) },
      { key: "focus", label: "Focus", value: Math.round(toSafeNumber(scores.focus)) },
      { key: "planning", label: "Planning", value: Math.round(toSafeNumber(scores.planning)) },
      { key: "adaptability", label: "Adaptability", value: Math.round(toSafeNumber(scores.adaptability)) },
    ];
  }, [context]);

  const stepState = (step: number) => {
    if (loadStep > step || (!loading && loadStep >= step)) return "done";
    if (loading && loadStep === step) return "current";
    return "pending";
  };

  const getTopicTarget = (topic: string) => {
    const growthAreas = recs?.growth_areas || [];
    const lower = topic.toLowerCase();
    const matched = growthAreas.find((g) => {
      const practice = String(g.practice_topic || "").toLowerCase();
      return practice === lower || practice.includes(lower) || lower.includes(practice);
    });
    return matched ? labelForSkill(matched.skill) : "";
  };

  const startSuggestedProblem = async (difficulty: string, title: string) => {
    try {
      const level = (difficulty || "medium").toLowerCase();
      const safeLevel = level === "easy" || level === "hard" ? level : "medium";
      const language = context?.language || "python";
      const sessionId = await startAssessment(language, safeLevel, title);
      navigate(`/assessment/${sessionId}`);
    } catch (err) {
      console.error("Unable to start suggested problem", err);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Navbar />
      <main className="max-w-6xl mx-auto px-4 pt-24 pb-12 space-y-6">
        <div className="relative overflow-hidden rounded-card border border-border bg-[radial-gradient(120%_120%_at_0%_0%,rgba(20,184,166,0.16),transparent_52%),radial-gradient(120%_120%_at_100%_100%,rgba(245,158,11,0.14),transparent_55%)] p-6">
          <p className="text-sm text-muted-foreground">Behavioral Cognitive Intelligence</p>
          <h1 className="text-3xl font-bold tracking-tight">AI Recommendations</h1>
        </div>

        {(loading || !recs || !context) && !error && !noReports && (
          <div className="glass-card rounded-card border border-border p-6 space-y-3">
            {[1, 2, 3].map((step) => {
              const state = stepState(step);
              const labels = [
                "Loading your session data",
                "Analyzing behavioral signals",
                "Generating AI insights",
              ];
              return (
                <div key={step} className="flex items-center gap-3 text-sm">
                  {state === "done" && <CheckCircle className="w-4 h-4 text-emerald-400" />}
                  {state === "current" && <Loader2 className="w-4 h-4 animate-spin text-teal" />}
                  {state === "pending" && <span className="w-2 h-2 rounded-full bg-bg-hover" />}
                  <span className={state === "done" ? "text-foreground" : "text-muted-foreground"}>
                    {labels[step - 1]}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {!loading && noReports && (
          <div className="glass-card rounded-card border border-border p-8 text-center">
            <div className="flex justify-center mb-3">
              <Brain className="w-8 h-8 text-teal" />
            </div>
            <p className="text-xl font-semibold">No assessments yet</p>
            <p className="text-sm text-muted-foreground mt-2">
              Complete your first assessment to get AI-powered insights based on your real behavioral data.
            </p>
            <button
              className="mt-4 px-4 py-2 rounded-btn border border-border bg-bg-surface"
              onClick={() => navigate("/practice")}
            >
              Start Assessment
            </button>
          </div>
        )}

        {!loading && error && (
          <div className="glass-card rounded-card border border-rose-500/30 p-5">
            <p className="text-sm text-rose-400">{error}</p>
            <button
              className="mt-3 px-4 py-2 rounded-btn border border-border bg-bg-surface"
              onClick={() => {
                void load();
              }}
            >
              Try again
            </button>
          </div>
        )}

        {!loading && !error && !noReports && recs && context && (
          <div className="space-y-6">
            <section className="glass-card rounded-card border border-border p-6 border-l-4 shadow-[0_8px_30px_rgba(20,184,166,0.14)]" style={{ borderLeftColor: "#14b8a6" }}>
              <h2 className="text-2xl font-bold">{recs.headline}</h2>
              <p className="text-sm text-muted-foreground mt-3">{recs.behavioral_story}</p>
            </section>

            <section className="glass-card rounded-card border border-border p-6">
              <h2 className="text-lg font-semibold mb-4">YOUR COGNITIVE SCORES</h2>
              <div className="space-y-4">
                {scoreRows.map((row) => {
                  const delta = context.trend ? toSafeNumber((context.trend as any)[row.key]) : null;
                  return (
                    <div key={row.key}>
                      <div className="flex items-center justify-between text-sm mb-1">
                        <span>{row.label}</span>
                        <div className="flex items-center gap-3">
                          <span className="font-semibold">{Math.round(row.value || 0)}/100</span>
                          {delta === null ? (
                            <span className="flex items-center gap-1 text-muted-foreground">
                              <Minus className="w-4 h-4 text-muted-foreground" />
                            </span>
                          ) : delta > 0 ? (
                            <span className="flex items-center gap-1 text-emerald-400">
                              <TrendingUp className="w-4 h-4 text-emerald-400" />
                              +{Math.round(delta || 0)}
                            </span>
                          ) : delta < 0 ? (
                            <span className="flex items-center gap-1 text-rose-400">
                              <TrendingDown className="w-4 h-4 text-rose-400" />
                              {Math.round(delta || 0)}
                            </span>
                          ) : (
                            <span className="flex items-center gap-1 text-muted-foreground">
                              <Minus className="w-4 h-4 text-muted-foreground" />
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="h-2 rounded-full bg-bg-hover overflow-hidden">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${Math.max(0, Math.min(100, Math.round(row.value || 0)))}%`,
                            transition: "width 1s ease",
                            background: scoreColor(Math.round(row.value || 0)),
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
              {recs.strength_note && (
                <div className="mt-4 flex items-start gap-2 text-emerald-400">
                  <CheckCircle className="w-4 h-4 mt-0.5" />
                  <p className="text-sm">{recs.strength_note}</p>
                </div>
              )}
            </section>

            <section className="space-y-3">
              <h2 className="text-lg font-semibold">WHERE TO FOCUS 🎯</h2>
              {(recs.growth_areas || []).map((area, idx) => (
                <div key={`${area.skill}-${idx}`} className="space-y-3">
                  <div className="glass-card rounded-card border border-border p-5 border-l-4" style={{ borderLeftColor: "#f59e0b" }}>
                    <div className="flex items-center justify-between">
                      <h3 className="font-semibold">{labelForSkill(area.skill)}</h3>
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-1 rounded-btn bg-bg-surface text-sm">{Math.round(area.score || 0)}/100</span>
                        <AlertTriangle className="w-4 h-4" style={{ color: "#f59e0b" }} />
                      </div>
                    </div>
                    <p className="text-sm text-muted-foreground mt-2 italic">Why weak: {area.why_weak}</p>
                    <p className="text-sm mt-2 flex items-start gap-2">
                      <ArrowRight className="w-4 h-4 mt-0.5 text-teal" />
                      <span>{area.fix}</span>
                    </p>
                    <div className="mt-3">
                      <span className="px-2 py-1 rounded-btn bg-bg-hover text-sm">Practice: {area.practice_topic}</span>
                    </div>
                  </div>
                  <button
                    className="px-4 py-2 rounded-btn border border-border bg-bg-surface"
                    onClick={() => navigate("/practice")}
                  >
                    Practice {area.practice_topic} now →
                  </button>
                </div>
              ))}
            </section>

            <section className="glass-card rounded-card border border-border p-6">
              <h2 className="text-lg font-semibold mb-4">STUDY TOPICS</h2>
              <div className="grid sm:grid-cols-2 gap-3">
                {(recs.recommended_topics || []).map((topic, idx) => {
                  const target = getTopicTarget(topic);
                  return (
                    <div key={`${topic}-${idx}`} className="rounded-card border border-border p-4 bg-bg-hover">
                      <p className="font-medium">{topic}</p>
                      {target && <p className="text-xs text-muted-foreground mt-1">Targets: {target}</p>}
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="glass-card rounded-card border border-border p-6">
              <h2 className="text-lg font-semibold mb-4">PRACTICE PROBLEMS</h2>
              <div className="space-y-3">
                {(recs.suggested_questions || []).map((q, idx) => (
                  <div key={`${q.title}-${idx}`} className="rounded-card border border-border p-4 bg-bg-hover">
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-medium">{q.title}</p>
                      <span className="px-2 py-1 rounded-btn bg-bg-surface text-xs uppercase">
                        {q.difficulty}
                      </span>
                    </div>
                    {q.tags.length > 0 && (
                      <p className="text-xs text-muted-foreground mt-1">Tags: {q.tags.join(", ")}</p>
                    )}
                    <p className="text-xs text-muted-foreground mt-1">Targets: {labelForSkill(q.targets_skill)}</p>
                    <button
                      className="mt-3 px-4 py-2 rounded-btn border border-border bg-bg-surface"
                      onClick={() => {
                        void startSuggestedProblem(q.difficulty, q.title);
                      }}
                    >
                      Start this problem
                    </button>
                  </div>
                ))}
              </div>
            </section>

            <section className="glass-card rounded-card border border-border p-6">
              <h2 className="text-lg font-semibold mb-4">MENTOR FEEDBACK</h2>
              <blockquote className="border-l-4 pl-4 text-base leading-relaxed" style={{ borderLeftColor: "#14b8a6" }}>
                {recs.personalized_feedback}
              </blockquote>
            </section>

            <section className="glass-card rounded-card border border-border p-6">
              <h2 className="text-lg font-semibold mb-4">4-WEEK PLAN</h2>
              <div className="relative pl-6">
                <div className="absolute left-2 top-1 bottom-1 w-px bg-border" />
                <div className="space-y-4">
                  {(recs.study_plan || []).map((step, idx) => {
                    const dotColors = ["#14b8a6", "#a855f7", "#f59e0b", "#10b981"];
                    return (
                      <div key={`${step}-${idx}`} className="relative">
                        <span
                          className="absolute -left-6 top-1.5 h-3 w-3 rounded-full"
                          style={{ background: dotColors[idx] || "#14b8a6" }}
                        />
                        <p className="text-sm">{step}</p>
                      </div>
                    );
                  })}
                </div>
              </div>
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
