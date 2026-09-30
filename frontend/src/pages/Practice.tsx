import Navbar from "@/components/Navbar";
import DifficultyBadge from "@/components/DifficultyBadge";
import GlowButton from "@/components/GlowButton";
import { useAssessmentSession } from "@/hooks/useAssessmentSession";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

type SkillKey = "problemSolving" | "debugging" | "focus" | "planning" | "adaptability";

type LessonItem = {
  title: string;
  objective: string;
  duration: string;
  difficulty: "Easy" | "Medium" | "Hard";
};

type SkillLessonPlan = {
  summary: string;
  lessons: LessonItem[];
};

const lessonLibrary: Record<SkillKey, SkillLessonPlan> = {
  problemSolving: {
    summary: "Your logic flow needs tighter step-by-step breakdowns.",
    lessons: [
      { title: "Input-Output Mapping", objective: "Translate problem statements into exact input/output behavior.", duration: "10 min", difficulty: "Easy" },
      { title: "Pattern Recognition Drill", objective: "Pick the right data structure in under 60 seconds.", duration: "15 min", difficulty: "Medium" },
      { title: "Edge Path Challenge", objective: "Solve one problem with 5 edge cases documented first.", duration: "20 min", difficulty: "Medium" },
    ],
  },
  debugging: {
    summary: "You lose time while fixing defects. We will tighten your debug loop.",
    lessons: [
      { title: "Trace Before Edit", objective: "Use manual tracing to isolate bug location before changing code.", duration: "12 min", difficulty: "Easy" },
      { title: "Failing Case First", objective: "Write one failing test before each fix.", duration: "15 min", difficulty: "Medium" },
      { title: "Root Cause Challenge", objective: "Fix three bugs and write one-line root causes.", duration: "18 min", difficulty: "Medium" },
    ],
  },
  focus: {
    summary: "Your coding rhythm drops during long sessions. We will rebuild steady focus.",
    lessons: [
      { title: "Single Task Sprint", objective: "8-minute uninterrupted coding block with no context switch.", duration: "8 min", difficulty: "Easy" },
      { title: "Pause Reduction Drill", objective: "Keep pauses under 2 seconds while solving a warmup.", duration: "12 min", difficulty: "Easy" },
      { title: "Deep Work Block", objective: "One medium problem in a strict no-switch window.", duration: "20 min", difficulty: "Medium" },
    ],
  },
  planning: {
    summary: "You can improve by planning solution shape before coding.",
    lessons: [
      { title: "Constraint Checklist", objective: "Write constraints and edge cases before implementation.", duration: "10 min", difficulty: "Easy" },
      { title: "Pseudo-code First", objective: "Produce pseudo-code before touching syntax.", duration: "12 min", difficulty: "Easy" },
      { title: "Plan-to-Code Execution", objective: "Solve one medium problem using only your written plan.", duration: "20 min", difficulty: "Medium" },
    ],
  },
  adaptability: {
    summary: "You need faster adjustment when problem constraints change.",
    lessons: [
      { title: "Constraint Twist", objective: "Adapt a solved problem after changing one major rule.", duration: "15 min", difficulty: "Medium" },
      { title: "Second Strategy Rewrite", objective: "Rewrite a working solution with a different approach.", duration: "18 min", difficulty: "Hard" },
      { title: "Adaptive Challenge", objective: "Solve one dynamic variant with strict time limit.", duration: "20 min", difficulty: "Hard" },
    ],
  },
};

const skillLabel = (skill: SkillKey) => {
  if (skill === "problemSolving") return "Problem Solving";
  if (skill === "adaptability") return "Adaptability";
  return skill.charAt(0).toUpperCase() + skill.slice(1);
};

const weaknessLevel = (score: number) => {
  if (score < 60) return "High";
  if (score < 80) return "Medium";
  return "Low";
};

const languages = ["python", "javascript", "java", "cpp", "c", "go", "rust"];

const Practice = () => {
  const navigate = useNavigate();
  const { reports, loadReports, startAssessment } = useAssessmentSession();
  const [selectedLanguage, setSelectedLanguage] = useState("python");
  const [questions, setQuestions] = useState<Record<string, { title: string; problem: string; difficulty: string } | null>>({});

  useEffect(() => {
    loadReports().catch(() => {});
  }, [loadReports]);

  const latestScores = useMemo(() => {
    if (!reports.length) {
      return {
        problemSolving: 65,
        debugging: 62,
        focus: 70,
        planning: 60,
        adaptability: 68,
      };
    }
    return reports[0].skillScores;
  }, [reports]);

  const previousScores = useMemo(() => {
    if (reports.length < 2) return null;
    return reports[1].skillScores;
  }, [reports]);

  const weakOrder = useMemo(() => {
    return (Object.entries(latestScores) as [SkillKey, number][])
      .sort((a, b) => a[1] - b[1])
      .map(([k]) => k);
  }, [latestScores]);

  const topWeak = weakOrder.slice(0, 3);

  useEffect(() => {
    const fromReport = reports[0]?.language;
    if (fromReport && languages.includes(fromReport)) {
      setSelectedLanguage(fromReport);
    }
  }, [reports]);

  const startFocusedLesson = async (skill: SkillKey, difficulty: "easy" | "medium" | "hard") => {
    try {
      const sessionId = await startAssessment(selectedLanguage, difficulty, skillLabel(skill));
      navigate(`/assessment/${sessionId}`);
    } catch (err) {
      console.error("Unable to start focused lesson", err);
      alert("Unable to start this lesson right now.");
    }
  };

  const startTopDrill = async () => {
    const skill = topWeak[0] || "problemSolving";
    const score = Number((latestScores as any)[skill] || 60);
    const level = score < 60 ? "easy" : score < 80 ? "medium" : "hard";
    await startFocusedLesson(skill, level);
  };

  useEffect(() => {
    if (topWeak.length === 0) return;
    const API = import.meta.env.VITE_AI_API_BASE
      || import.meta.env.VITE_CODE_RUNNER_URL
      || "https://mind-code-gilt.vercel.app";

    topWeak.forEach((skill) => {
      const score = Number((latestScores as any)[skill] || 60);
      const level = score < 60 ? "easy" : score < 80 ? "medium" : "hard";
      fetch(`${API}/question`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          language: selectedLanguage,
          level,
          topic: skillLabel(skill)
        }),
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (!data?.question) return;
          setQuestions((prev) => ({
            ...prev,
            [skill]: {
              title: data.question.title || "Personalized Challenge",
              problem: data.question.problem || "",
              difficulty: data.question.difficulty || level,
            },
          }));
        })
        .catch(() => {});
    });
  }, [topWeak, selectedLanguage]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Navbar />
      <main className="max-w-6xl mx-auto px-4 pt-24 pb-12 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-muted-foreground">Personalized drills</p>
            <h1 className="text-4xl font-bold">Practice Play</h1>
            <p className="text-sm text-muted-foreground mt-2">
              Lesson plan generated from your weakest skills: {topWeak.map((s) => skillLabel(s)).join(", ")}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <select
              className="px-3 py-2 rounded-btn border border-border bg-bg-surface text-sm uppercase"
              value={selectedLanguage}
              onChange={(e) => setSelectedLanguage(e.target.value)}
            >
              {languages.map((lang) => (
                <option key={lang} value={lang}>{lang}</option>
              ))}
            </select>
            <GlowButton size="sm" onClick={startTopDrill}>Start a new drill</GlowButton>
          </div>
        </div>

        <div className="grid md:grid-cols-3 gap-4">
          {topWeak.map((skill) => {
            const score = Math.round((latestScores as any)[skill] || 0);
            const prevScore = previousScores
              ? Math.round((previousScores as any)[skill] || 0)
              : null;
            const delta = prevScore !== null ? score - prevScore : null;
            const neededToGood = Math.max(0, 75 - score);

            return (
              <div key={skill} className="glass-card rounded-card p-4 border border-border">
                <p className="text-xs text-muted-foreground">Weak Area</p>
                <h3 className="font-semibold text-lg">{skillLabel(skill)}</h3>

                <div className="mt-3 h-2 bg-white/10 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{
                      width: `${score}%`,
                      background: score < 60 ? "#ef4444" : score < 75 ? "#f59e0b" : "#10b981",
                    }}
                  />
                </div>

                <div className="mt-2 flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Score</span>
                  <span
                    className="font-semibold"
                    style={{
                      color: score < 60 ? "#ef4444" : score < 75 ? "#f59e0b" : "#10b981"
                    }}
                  >
                    {score}/100
                  </span>
                </div>

                {delta !== null && (
                  <div className="mt-1 flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">vs last session</span>
                    <span className={delta >= 0 ? "text-emerald-400" : "text-rose-400"}>
                      {delta >= 0 ? "+" : ""}{delta}
                    </span>
                  </div>
                )}

                {neededToGood > 0 && (
                  <p className="text-xs text-muted-foreground mt-2">
                    +{neededToGood} pts to reach proficiency
                  </p>
                )}
              </div>
            );
          })}
        </div>

        <div className="space-y-4">
          {topWeak.map((skill) => {
            const plan = lessonLibrary[skill];
            const avgScore = Math.round((latestScores as any)[skill] || 0);
            const level = weaknessLevel(avgScore);

            return (
              <div key={skill} className="glass-card rounded-card p-5 border border-border">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xl font-semibold">{skillLabel(skill)} Lesson Path</h3>
                  <span className="text-xs text-muted-foreground">3-step plan · {level} priority</span>
                </div>
                <p className="text-sm text-muted-foreground mb-4">{plan.summary}</p>

                <div className="grid md:grid-cols-3 gap-3">
                  {plan.lessons.map((lesson, idx) => (
                    <div key={lesson.title} className="rounded-xl border border-border p-4 bg-bg-hover/30">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs text-muted-foreground">Step {idx + 1}</span>
                        <DifficultyBadge difficulty={lesson.difficulty as any} />
                      </div>
                      <h4 className="font-semibold mb-1">{lesson.title}</h4>
                      <p className="text-sm text-muted-foreground mb-3">{lesson.objective}</p>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-muted-foreground">{lesson.duration}</span>
                        <GlowButton size="sm" variant="ghost" onClick={() => startFocusedLesson(skill, lesson.difficulty.toLowerCase() as "easy" | "medium" | "hard")}>Start lesson</GlowButton>
                      </div>
                    </div>
                  ))}
                </div>

                {questions[skill] && (
                  <div className="mt-4 pt-4 border-t border-border">
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="text-sm font-semibold text-teal">
                        AI-Generated Challenge for {skillLabel(skill)}
                      </h4>
                      <DifficultyBadge difficulty={questions[skill]!.difficulty as any} />
                    </div>
                    <p className="text-xs text-muted-foreground mb-3 line-clamp-3">
                      {questions[skill]!.problem}
                    </p>
                    <GlowButton
                      size="sm"
                      onClick={() => startFocusedLesson(skill, questions[skill]!.difficulty.toLowerCase() as any)}
                    >
                      Start: {questions[skill]!.title}
                    </GlowButton>
                  </div>
                )}

                {!questions[skill] && (
                  <div className="mt-4 pt-4 border-t border-border">
                    <p className="text-xs text-muted-foreground">
                      Loading AI challenge for {skillLabel(skill)}…
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </main>
    </div>
  );
};

export default Practice;
