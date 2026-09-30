import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Play,
  Download,
  Activity,
  Sparkles,
  Target,
  Shield,
  FileText,
  History,
  TrendingUp,
  User,
  Flame,
  BarChart3,
  Zap,
  Clock,
} from "lucide-react";
import {
  ResponsiveContainer,
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
} from "recharts";
import GlowButton from "@/components/GlowButton";
import DifficultyBadge from "@/components/DifficultyBadge";
import { useAssessmentSession, formatDate } from "@/hooks/useAssessmentSession";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import DashboardSidebar from "@/components/DashboardSidebar";

const languages = ["python", "javascript", "cpp", "java", "c", "go", "rust"];
const difficulties = ["easy", "medium", "hard"];

const Dashboard = () => {
  const navigate = useNavigate();
  const {
    reports,
    startAssessment,
    loadReports,
  } = useAssessmentSession();
  const [open, setOpen] = useState(false);
  const [language, setLanguage] = useState("python");
  const [difficulty, setDifficulty] = useState("medium");
  const [radarMode, setRadarMode] = useState<"latest" | "average">("latest");

  const safeReports = useMemo(
    () =>
      (Array.isArray(reports) ? reports : []).filter(
        (r) =>
          r &&
          typeof r.id === "string" &&
          r.skillScores &&
          Number.isFinite(Number(r.createdAt))
      ),
    [reports]
  );
  const latestReport = safeReports[0];
  const hasData = Boolean(latestReport);
  const totals = useMemo(() => {
    const count = safeReports.length || 1;
    const focus = safeReports.reduce((a, r) => a + Number(r.skillScores.focus || 0), 0) / count;
    const debug = safeReports.reduce((a, r) => a + Number(r.skillScores.debugging || 0), 0) / count;
    return { count: safeReports.length, focus: Math.round(focus), debug: Math.round(debug) };
  }, [safeReports]);

  const avgSkills = useMemo(() => {
    if (!safeReports.length) return null;
    const sum = safeReports.reduce(
      (acc, r) => ({
        problemSolving: acc.problemSolving + Number(r.skillScores.problemSolving || 0),
        debugging: acc.debugging + Number(r.skillScores.debugging || 0),
        focus: acc.focus + Number(r.skillScores.focus || 0),
        planning: acc.planning + Number(r.skillScores.planning || 0),
        adaptability: acc.adaptability + Number(r.skillScores.adaptability || 0),
      }),
      { problemSolving: 0, debugging: 0, focus: 0, planning: 0, adaptability: 0 }
    );
    return {
      problemSolving: sum.problemSolving / safeReports.length,
      debugging: sum.debugging / safeReports.length,
      focus: sum.focus / safeReports.length,
      planning: sum.planning / safeReports.length,
      adaptability: sum.adaptability / safeReports.length,
    };
  }, [safeReports]);

  const radarData = useMemo(() => {
    const base = radarMode === "latest" ? latestReport?.skillScores : avgSkills;
    if (!base) return [];
    return [
      { subject: "Problem Solving", A: base.problemSolving },
      { subject: "Debugging", A: base.debugging },
      { subject: "Focus", A: base.focus },
      { subject: "Planning", A: base.planning },
      { subject: "Adaptability", A: base.adaptability },
    ];
  }, [latestReport, avgSkills, radarMode]);

  const trendData = useMemo(() => {
    const ordered = [...safeReports].sort((a, b) => a.createdAt - b.createdAt);
    return ordered.map((r, idx) => {
      const learningScore = Math.round(
        (Number(r.skillScores.problemSolving || 0) +
          Number(r.skillScores.planning || 0) +
          Number(r.skillScores.adaptability || 0)) /
          3
      );
      return {
        name: `S${idx + 1}`,
        assessmentsCompleted: idx + 1,
        learningCompleted: learningScore,
      };
    });
  }, [safeReports]);

  const weakAreas = useMemo(() => {
    const skills = latestReport?.skillScores;
    const items: { label: string; reason: string; to: string }[] = [];
    if (!skills) {
      return [
        { label: "Edge Cases", reason: "Missing recent data", to: "/dashboard#start" },
        { label: "Debugging", reason: "Build error resilience", to: "/dashboard#start" },
      ];
    }
    if (skills.planning < 80) items.push({ label: "Edge Cases", reason: "Planning dips on boundary handling", to: "/assessment/new" });
    if (skills.debugging < 80) items.push({ label: "Debugging", reason: "Backspace spikes during fixes", to: "/assessment/new" });
    if (skills.focus < 80) items.push({ label: "Focus Drills", reason: "Focus drops detected", to: "/assessment/new" });
    if (skills.problemSolving < 80) items.push({ label: "Arrays & Loops", reason: "Logic iterations slowed", to: "/assessment/new" });
    return items.slice(0, 4);
  }, [latestReport]);

  const handleStart = async () => {
    try {
      const sessionId = await startAssessment(language, difficulty);
      if (!sessionId) throw new Error("Question generation failed");
      setOpen(false);
      navigate(`/assessment/${sessionId}`);
    } catch (err: any) {
      alert(err?.message || "Unable to start assessment. Check AI backend configuration.");
    }
  };

  useEffect(() => {
    loadReports().catch(() => {});
  }, [loadReports]);

  return (
    <div className="min-h-screen bg-background">
      <div className="flex">
        <div className="hidden lg:block shrink-0">
          <DashboardSidebar />
        </div>
        <main className="flex-1 p-6 space-y-6 overflow-auto" id="start">
          {/* Hero strip */}
          <div className="glass-card gradient-card rounded-card p-5 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <p className="text-sm text-teal flex items-center gap-2"><Sparkles className="w-4 h-4" /> Assessment-first workflow</p>
              <h2 className="text-2xl font-bold text-foreground mt-1">Launch a guided cognitive + behavioral run</h2>
              <p className="text-sm text-muted-foreground mt-2">Language & difficulty are locked for the session. Live telemetry captures focus, keystrokes, pauses, and anti-cheat signals.</p>
            </div>
            <div className="flex gap-3">
              <GlowButton size="md" onClick={() => setOpen(true)}>
                <Play className="w-4 h-4 mr-2" /> Start Assessment
              </GlowButton>
              <button className="px-4 py-2 rounded-btn border border-border text-sm text-muted-foreground hover:text-foreground" onClick={() => navigate("/reports")}>View Reports</button>
            </div>
          </div>

          {/* Stat ribbon */}
          <div className="grid md:grid-cols-4 gap-3">
            {[
              { label: "Sessions", value: totals.count || 0, chip: "All time", icon: History, color: "text-teal" },
              { label: "Avg Focus", value: `${totals.focus}%`, chip: "Last 30d", icon: Flame, color: "text-rose" },
              { label: "Debug lift", value: `${totals.debug}%`, chip: "Stability", icon: BarChart3, color: "text-ice" },
            ].map((card) => (
              <div key={card.label} className="glass-card rounded-card p-4 border border-border flex items-center justify-between bg-gradient-to-br from-bg-surface to-bg-hover/60">
                <div>
                  <p className="text-xs text-muted-foreground flex items-center gap-1"><card.icon className={`w-3 h-3 ${card.color}`} /> {card.chip}</p>
                  <p className="text-lg font-semibold text-foreground">{card.value}</p>
                  <p className="text-sm text-muted-foreground">{card.label}</p>
                </div>
                <div className="w-10 h-10 rounded-full border border-border flex items-center justify-center bg-bg-elevated shadow-inner">
                  <Zap className={`w-4 h-4 ${card.color}`} />
                </div>
              </div>
            ))}
          </div>

          {/* Skill + Timeline */}
          <div className="grid lg:grid-cols-[2fr,1fr] gap-4" id="reports">
            <div className="glass-card rounded-card p-5 gradient-card relative overflow-hidden">
              <div className="absolute -left-10 -top-10 w-40 h-40 bg-ice/10 rounded-full blur-3xl" />
              <div className="flex items-center justify-between mb-3 relative z-10">
                <h3 className="font-semibold text-foreground">Skill DNA Radar</h3>
                <div className="flex items-center gap-2">
                  <button
                    className={cn("text-xs px-2 py-1 rounded-btn border", radarMode === "latest" ? "border-teal text-foreground" : "border-border text-muted-foreground")}
                    onClick={() => setRadarMode("latest")}
                  >
                    Latest
                  </button>
                  <button
                    className={cn("text-xs px-2 py-1 rounded-btn border", radarMode === "average" ? "border-teal text-foreground" : "border-border text-muted-foreground")}
                    onClick={() => setRadarMode("average")}
                  >
                    Average
                  </button>
                </div>
              </div>
              {hasData ? (
                <ResponsiveContainer width="100%" height={260}>
                  <RadarChart data={radarData} outerRadius="70%">
                    <PolarGrid stroke="hsl(210,15%,16%)" />
                    <PolarAngleAxis dataKey="subject" tick={{ fill: "hsl(210,12%,60%)", fontSize: 11 }} />
                    <PolarRadiusAxis angle={30} domain={[0, 100]} tick={{ fill: "hsl(210,12%,40%)", fontSize: 10 }} />
                    <Radar dataKey="A" stroke="#14B8A6" fill="#14B8A6" fillOpacity={0.2} strokeWidth={2} />
                  </RadarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[260px] flex items-center justify-center text-sm text-muted-foreground border border-dashed border-border rounded-xl bg-bg-surface/60">
                  Complete your first assessment to unlock Skill DNA radar.
                </div>
              )}
            </div>
            <div className="glass-card rounded-card p-5 border border-border bg-bg-hover/60 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-foreground flex items-center gap-2"><Target className="w-4 h-4 text-rose" /> Weakest signals</h3>
                <span className="text-xs text-muted-foreground">Auto-updated</span>
              </div>
              <div className="space-y-3">
                {weakAreas.slice(0, 4).map((w) => (
                  <div key={w.label} className="flex items-center justify-between p-3 rounded-btn bg-bg-surface border border-border">
                    <div>
                      <p className="text-sm font-semibold text-foreground">{w.label}</p>
                      <p className="text-xs text-muted-foreground">{w.reason}</p>
                    </div>
                    <Link to={w.to} className="text-xs text-teal hover:underline">Drill</Link>
                  </div>
                ))}
                {weakAreas.length === 0 && (
                  <p className="text-sm text-muted-foreground">Complete a session to unlock personalized drills.</p>
                )}
              </div>
            </div>
          </div>

          <div className="glass-card rounded-card p-5 gradient-card relative overflow-hidden">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-foreground">Progress Trend</h3>
              <span className="text-xs text-muted-foreground">Assessments vs learning completed</span>
            </div>
            {trendData.length > 0 ? (
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={trendData}>
                  <CartesianGrid stroke="hsl(210,15%,16%)" strokeDasharray="3 3" />
                  <XAxis dataKey="name" tick={{ fill: "hsl(210,12%,60%)", fontSize: 11 }} />
                  <YAxis yAxisId="left" tick={{ fill: "hsl(210,12%,60%)", fontSize: 11 }} />
                  <YAxis yAxisId="right" orientation="right" domain={[0, 100]} tick={{ fill: "hsl(210,12%,60%)", fontSize: 11 }} />
                  <Tooltip />
                  <Legend />
                  <Line yAxisId="left" type="monotone" dataKey="assessmentsCompleted" name="Assessments completed" stroke="#38BDF8" strokeWidth={2} dot={{ r: 2 }} />
                  <Line yAxisId="right" type="monotone" dataKey="learningCompleted" name="Learning completed" stroke="#34D399" strokeWidth={2} dot={{ r: 2 }} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[260px] flex items-center justify-center text-sm text-muted-foreground border border-dashed border-border rounded-xl bg-bg-surface/60">
                Complete your first assessment to unlock trend graph.
              </div>
            )}
          </div>

          {/* Reports table + history */}
          <div className="glass-card rounded-card overflow-hidden border border-border">
            <div className="p-5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-teal" />
                <h3 className="font-semibold text-foreground">Assessment History & Reports</h3>
              </div>
              <button className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">
                <Download className="w-3 h-3" /> Export all
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-muted-foreground border-b border-border">
                  <tr>
                    <th className="py-3 px-5 text-left font-medium">Date</th>
                    <th className="py-3 px-5 text-left font-medium">Problem</th>
                    <th className="py-3 px-5 text-left font-medium">Lang</th>
                    <th className="py-3 px-5 text-left font-medium">Diff</th>
                    <th className="py-3 px-5 text-left font-medium">Focus</th>
                    <th className="py-3 px-5 text-left font-medium">Debug</th>
                    <th className="py-3 px-5 text-left font-medium">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {safeReports.length === 0 && (
                    <tr>
                      <td className="py-4 px-5 text-muted-foreground" colSpan={7}>No assessments yet. Start your first run.</td>
                    </tr>
                  )}
                  {safeReports.map((r) => (
                    <tr key={r.id} className="border-b border-border last:border-0 hover:bg-bg-hover/60 transition-colors">
                      <td className="py-3 px-5 text-foreground">{formatDate(r.createdAt)}</td>
                      <td className="py-3 px-5 text-foreground">{r.problemTitle}</td>
                      <td className="py-3 px-5 uppercase text-muted-foreground">{r.language}</td>
                      <td className="py-3 px-5"><DifficultyBadge difficulty={r.difficulty as any} /></td>
                      <td className="py-3 px-5 text-teal font-medium">{Math.round(r.skillScores.focus)}%</td>
                      <td className="py-3 px-5 text-ice font-medium">{Math.round(r.skillScores.debugging)}%</td>
                      <td className="py-3 px-5">
                        <Link to={`/result/${r.id}`} className="text-sm text-teal hover:underline">Open</Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {safeReports.length > 0 && (
              <div className="p-4 border-t border-border bg-bg-hover/40 grid sm:grid-cols-3 gap-3 text-xs">
                <div className="rounded-btn bg-bg-elevated border border-border p-3">
                  <div className="flex items-center gap-2 text-muted-foreground"><History className="w-3 h-3" /> Sessions</div>
                  <div className="text-lg font-semibold text-foreground mt-1">{safeReports.length}</div>
                </div>
                <div className="rounded-btn bg-bg-elevated border border-border p-3">
                  <div className="flex items-center gap-2 text-muted-foreground"><Activity className="w-3 h-3" /> Avg Focus</div>
                  <div className="text-lg font-semibold text-teal mt-1">
                    {Math.round(safeReports.reduce((a, r) => a + Number(r.skillScores.focus || 0), 0) / safeReports.length)}%
                  </div>
                </div>
                <div className="rounded-btn bg-bg-elevated border border-border p-3">
                  <div className="flex items-center gap-2 text-muted-foreground"><TrendingUp className="w-3 h-3" /> Debug Lift</div>
                  <div className="text-lg font-semibold text-ice mt-1">
                    {Math.round(safeReports.reduce((a, r) => a + Number(r.skillScores.debugging || 0), 0) / safeReports.length)}%
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Micro metrics */}
          <div className="grid md:grid-cols-3 gap-4">
            {[{ icon: Activity, label: "Anti-cheat", desc: "Tab switches, fullscreen exits tracked live", color: "text-rose" },
              { icon: Shield, label: "Struggle Engine", desc: "Per-line pause/backspace score", color: "text-teal" },
              { icon: Clock, label: "Timeline", desc: "Behavior curve across the session", color: "text-ice" }].map((card) => (
              <div key={card.label} className="glass-card rounded-card p-4 flex items-start gap-3 gradient-card">
                <div className={cn("w-10 h-10 rounded-lg bg-bg-hover flex items-center justify-center", card.color)}>
                  <card.icon className="w-5 h-5" />
                </div>
                <div>
                  <p className="font-semibold text-foreground">{card.label}</p>
                  <p className="text-sm text-muted-foreground">{card.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </main>
      </div>

        {/* Pre-assessment modal */}
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="bg-bg-surface border-border">
            <DialogHeader>
              <DialogTitle>Configure Assessment</DialogTitle>
            </DialogHeader>
          <div className="space-y-4">
            <div>
              <p className="text-xs text-muted-foreground mb-2">Programming Language</p>
              <div className="grid grid-cols-2 gap-2">
                {languages.map((lang) => (
                  <button
                    key={lang}
                    onClick={() => setLanguage(lang)}
                    className={cn(
                      "rounded-btn px-3 py-2 border text-sm capitalize",
                      language === lang ? "border-teal text-foreground bg-teal/10" : "border-border text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {lang}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-2">Difficulty</p>
              <div className="grid grid-cols-3 gap-2">
                {difficulties.map((lvl) => (
                  <button
                    key={lvl}
                    onClick={() => setDifficulty(lvl)}
                    className={cn(
                      "rounded-btn px-3 py-2 border text-sm capitalize",
                      difficulty === lvl ? "border-teal text-foreground bg-teal/10" : "border-border text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {lvl}
                  </button>
                ))}
              </div>
            </div>
            <GlowButton className="w-full" onClick={handleStart}>
              <Play className="w-4 h-4 mr-2" /> Start
            </GlowButton>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Dashboard;
