import { useEffect, useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Brain, Download, ArrowLeft, Flame, CheckCircle2, XCircle } from "lucide-react";
import {
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ComposedChart,
  Area,
  Scatter,
  CartesianGrid,
  XAxis,
  YAxis,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts";
import { useAssessmentSession, heatColor, struggleScore } from "@/hooks/useAssessmentSession";
import GlowButton from "@/components/GlowButton";
import { cn } from "@/lib/utils";
import { downloadBrandedReportPdf } from "@/lib/reportPdf";
import HeatmapChart from "@/components/HeatmapChart";

const Result = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { reports, loadReports } = useAssessmentSession();
  const report = reports.find((r) => r.id === id);

  useEffect(() => {
    if (!report) {
      loadReports().catch(() => {});
    }
  }, [report, loadReports]);

  useEffect(() => {
    const onPopState = () => {
      navigate("/dashboard", { replace: true });
    };

    // Keep one local history entry so browser Back from Result always lands on Dashboard.
    window.history.pushState({ fromResult: true }, "", window.location.href);
    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener("popstate", onPopState);
    };
  }, [navigate]);

  const radarData = useMemo(() => {
    if (!report) return [];
    const s = report.skillScores;
    return [
      { subject: "Problem Solving", A: s.problemSolving },
      { subject: "Debugging", A: s.debugging },
      { subject: "Focus", A: s.focus },
      { subject: "Planning", A: s.planning },
      { subject: "Adaptability", A: s.adaptability },
    ];
  }, [report]);

  const summaryLines = useMemo(() => {
    if (!report?.insights?.summary) return [];
    return String(report.insights.summary)
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 5);
  }, [report]);

  if (!report) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center text-muted-foreground">
        Report not found. <button className="underline ml-2" onClick={() => navigate("/dashboard")}>Back</button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="h-14 border-b border-border flex items-center justify-between px-6 bg-bg-surface/70 backdrop-blur">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate("/dashboard", { replace: true })} className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="w-8 h-8 rounded-lg gradient-btn flex items-center justify-center">
            <Brain className="w-4 h-4 text-primary-foreground" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">MindCode Report</p>
            <h1 className="text-lg font-semibold">{report.problemTitle}</h1>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate("/dashboard")}
            className="px-3 py-2 rounded-btn border border-border text-sm text-muted-foreground hover:text-foreground"
          >
            Exit
          </button>
          <GlowButton size="sm" onClick={() => downloadBrandedReportPdf([report], `mindcode-report-${report.id}.pdf`)}>
            <Download className="w-3 h-3 mr-2" /> Download Report (PDF)
          </GlowButton>
        </div>
      </header>

      <main className="p-6 space-y-6 max-w-6xl mx-auto">
        <div className="grid lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 glass-card rounded-card p-5 gradient-card">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold">Skill DNA Radar</h3>
              <span className="text-xs text-muted-foreground">Language: {report.language.toUpperCase()} · {report.difficulty}</span>
            </div>
            <ResponsiveContainer width="100%" height={300}>
              <RadarChart data={radarData} outerRadius="70%">
                <PolarGrid stroke="hsl(210,15%,16%)" />
                <PolarAngleAxis dataKey="subject" tick={{ fill: "hsl(210,12%,60%)", fontSize: 11 }} />
                <PolarRadiusAxis angle={30} domain={[0, 100]} tick={{ fill: "hsl(210,12%,40%)", fontSize: 10 }} />
                <Radar dataKey="A" stroke="#A855F7" fill="#A855F7" fillOpacity={0.2} strokeWidth={2} />
              </RadarChart>
            </ResponsiveContainer>
          </div>
          
          <div className="glass-card rounded-card p-5 gradient-card">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold">AI Insights</h3>
              <Flame className="w-4 h-4 text-teal" />
            </div>

            {/* 5-line assessment summary from real session data */}
            {summaryLines.length > 0 && (
              <div className="mb-4 p-3 rounded-lg bg-white/5 border border-white/10">
                <div className="space-y-1">
                  {summaryLines.map((line, idx) => (
                    <p key={`${idx}-${line}`} className="text-xs text-muted-foreground leading-relaxed">
                      {line}
                    </p>
                  ))}
                </div>
              </div>
            )}

            {/* Strengths — now from real data */}
            {report.insights.strengths.length > 0 && (
              <div className="mb-4">
                <p className="text-xs font-semibold mb-2" style={{color:'#14b8a6'}}>
                  ✓ STRENGTHS
                </p>
                <div className="space-y-1">
                  {report.insights.strengths.map((s, i) => (
                    <div key={i} className="flex items-start gap-2 text-sm">
                      <span style={{color:'#10b981'}} className="mt-0.5 shrink-0">›</span>
                      <span className="text-muted-foreground">{s}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Weaknesses — now from real data */}
            {report.insights.weaknesses.length > 0 && (
              <div>
                <p className="text-xs font-semibold mb-2 text-rose-400">
                  ⚠ NEEDS WORK
                </p>
                <div className="space-y-1">
                  {report.insights.weaknesses.map((w, i) => (
                    <div key={i} className="flex items-start gap-2 text-sm">
                      <span className="text-rose-400 mt-0.5 shrink-0">›</span>
                      <span className="text-muted-foreground">{w}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {summaryLines.length === 0 && (
              <p className="text-xs text-muted-foreground mt-3">
                Insight summary is being prepared from session telemetry.
              </p>
            )}
          </div>
        </div>

        <div className="grid lg:grid-cols-3 gap-4">
          {(() => {
            const verdict = report.runVerdict;
            const normalizeComparable = (value?: string) =>
              String(value || "")
                .replace(/\r\n/g, "\n")
                .split("\n")
                .map((line) => line.replace(/\s+$/g, ""))
                .join("\n")
                .trim();
            const compareOutputs = (expected?: string, actual?: string) => {
              if (expected == null || actual == null) return null;
              return normalizeComparable(expected) === normalizeComparable(actual);
            };
            const derived = compareOutputs(verdict?.expected, verdict?.actual);
            const passed = derived === true || verdict?.passed === true;
            const failed = derived === false || verdict?.passed === false;
            const tone = passed ? "#22c55e" : failed ? "#ef4444" : "var(--border)";
            const toneBg = passed ? "#22c55e1f" : failed ? "#ef44441f" : "transparent";
            return (
              <div
                className={cn(
                  "rounded-card p-5 lg:col-span-3 border shadow-sm relative overflow-hidden",
                  "transition-colors"
                )}
                style={{
                  borderColor: tone + (passed || failed ? "80" : ""),
                  background: toneBg,
                  color: passed ? "#22c55e" : failed ? "#ef4444" : undefined,
                }}
              >
                <div className="absolute inset-0 pointer-events-none opacity-15 bg-gradient-to-r from-white/10 via-transparent to-white/5" />
                <div className="relative flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div
                      className={cn(
                        "w-9 h-9 rounded-full flex items-center justify-center",
                        passed ? "bg-emerald-500/20" : failed ? "bg-rose-500/20" : "bg-border"
                      )}
                      style={{ color: tone }}
                    >
                      {passed ? (
                        <CheckCircle2 className="w-5 h-5" />
                      ) : failed ? (
                        <XCircle className="w-5 h-5" />
                      ) : (
                        <Flame className="w-5 h-5 text-muted-foreground" />
                      )}
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Execution vs Sample</p>
                      <h3 className="text-base font-semibold">Solution Check</h3>
                    </div>
                  </div>
                  <span
                    className={cn(
                      "px-3 py-1 rounded-full text-xs font-semibold border",
                      passed
                        ? "bg-emerald-500/20 border-emerald-400/50"
                        : failed
                          ? "bg-rose-500/20 border-rose-400/50"
                          : "bg-bg-surface border-border text-muted-foreground"
                    )}
                    style={{
                      color: passed ? "#22c55e" : failed ? "#ef4444" : undefined,
                      borderColor: tone,
                    }}
                  >
                    {passed ? "PASSED" : failed ? "FAILED" : "NOT RUN"}
                  </span>
                </div>

                <div className="relative grid md:grid-cols-3 gap-4 text-sm">
                  <div className="space-y-1">
                    <p
                      className={cn(
                        "text-[11px] uppercase tracking-wide",
                      passed ? "text-emerald-200" : failed ? "text-rose-200" : "text-muted-foreground"
                    )}
                  >
                    Sample Input
                  </p>
                  <pre
                      className={cn(
                        "rounded-md border p-3 whitespace-pre-wrap break-words text-xs bg-black/10",
                        passed
                          ? "border-emerald-400/60"
                          : failed
                            ? "border-rose-400/60"
                            : "border-border/70"
                      )}
                      style={{
                        color: passed ? "#22c55e" : failed ? "#ef4444" : undefined,
                        borderColor: tone,
                      }}
                    >
                      {verdict?.sampleInput ?? "N/A"}
                    </pre>
                  </div>
                  <div className="space-y-1">
                    <p
                      className={cn(
                        "text-[11px] uppercase tracking-wide",
                        passed ? "text-emerald-200" : failed ? "text-rose-200" : "text-muted-foreground"
                      )}
                    >
                      Expected Output
                    </p>
                    <pre
                      className={cn(
                        "rounded-md border p-3 whitespace-pre-wrap break-words text-xs bg-black/10",
                        passed
                          ? "border-emerald-400/60"
                          : failed
                            ? "border-rose-400/60"
                            : "border-border/70"
                      )}
                      style={{
                        color: passed ? "#22c55e" : failed ? "#ef4444" : undefined,
                        borderColor: tone,
                      }}
                    >
                      {verdict?.expected ?? "N/A"}
                    </pre>
                  </div>
                  <div className="space-y-1">
                    <p
                      className={cn(
                        "text-[11px] uppercase tracking-wide",
                        passed ? "text-emerald-200" : failed ? "text-rose-200" : "text-muted-foreground"
                      )}
                    >
                      Your Output
                    </p>
                    <pre
                      className={cn(
                        "rounded-md border p-3 whitespace-pre-wrap break-words text-xs bg-black/10",
                        passed
                          ? "border-emerald-400/60"
                          : failed
                            ? "border-rose-400/60"
                            : "border-border/70"
                      )}
                      style={{
                        color: passed ? "#22c55e" : failed ? "#ef4444" : undefined,
                        borderColor: tone,
                      }}
                    >
                      {verdict?.actual ?? "Not captured (run not executed)"}
                    </pre>
                  </div>
                </div>

                <p
                  className={cn(
                    "relative mt-4 text-sm font-medium",
                    passed ? "text-emerald-500" : failed ? "text-rose-500" : "text-muted-foreground"
                  )}
                  style={{ color: passed ? "#22c55e" : failed ? "#ef4444" : undefined }}
                >
                  {passed
                    ? "Correct Output"
                    : failed
                      ? "Output did not match the expected sample output."
                      : "Run not captured for this report. Re-run to record a verdict."}
                </p>
              </div>
            );
          })()}

          <HeatmapChart heatmap={report.heatmap} />

          <div className="glass-card rounded-card p-5 lg:col-span-2">
            <h3 className="font-semibold mb-3">Behavior Timeline</h3>

            {report.behaviorTimeline.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                Timeline is recorded during a live session only.
                Complete a new assessment to see your behavioral chart.
              </p>
            ) : (() => {
              // Derive per-interval deltas from cumulative totals
              const points = report.behaviorTimeline;
              const chartData = points.map((p, i) => {
                const prev = points[i - 1];
                const deltaKeys = prev ? Math.max(0, p.keystrokes - prev.keystrokes) : p.keystrokes;
                const deltaBacks = prev ? Math.max(0, p.backspaces - prev.backspaces) : p.backspaces;
                const elapsedSec = Math.round((p.timestamp - points[0].timestamp) / 1000);
                const mins = Math.floor(elapsedSec / 60);
                const secs = elapsedSec % 60;
                const label = mins > 0 ? `${mins}m${secs}s` : `${secs}s`;
                return { label, elapsedSec, focus: p.focus, deltaKeys, deltaBacks };
              });

              // Session summary stats
              const avgFocus = Math.round((chartData.reduce((s, d) => s + d.focus, 0) / Math.max(1, chartData.length)) || 0);
              const peakFocus = Math.max(0, ...chartData.map(d => Math.round(d.focus || 0)));
              const lowestFocus = Math.min(100, ...chartData.map(d => Math.round(d.focus || 0)));
              const idleCount = chartData.filter(d => d.deltaKeys === 0).length;
              const burstCount = chartData.filter(d => d.deltaBacks > 4).length;
              const duration = chartData.length > 0
                ? (() => {
                    const s = Math.max(0, Math.round(chartData[chartData.length - 1].elapsedSec || 0));
                    return `${Math.floor(s/60)}m ${s%60}s`;
                  })()
                : '—';

              return (
                <div>
                  {/* Chart using recharts — import at top of file */}
                  <ResponsiveContainer width="100%" height={160}>
                    <ComposedChart data={chartData} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                      <defs>
                        <linearGradient id="focusGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#14b8a6" stopOpacity={0.5} />
                          <stop offset="95%" stopColor="#14b8a6" stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                      <XAxis
                        dataKey="label"
                        tick={{ fill: '#64748b', fontSize: 10 }}
                        interval={Math.max(0, Math.floor(chartData.length / 8) - 1)}
                      />
                      <YAxis
                        domain={[0, 100]}
                        tick={{ fill: '#64748b', fontSize: 10 }}
                        tickFormatter={(v) => `${v}%`}
                      />
                      <Area
                        type="monotone"
                        dataKey="focus"
                        stroke="#14b8a6"
                        strokeWidth={2}
                        fill="url(#focusGrad)"
                        dot={false}
                        activeDot={{ r: 4, fill: '#14b8a6' }}
                      />
                      {/* Event dots: red for deletion burst, amber for idle */}
                      <Scatter
                        data={chartData.filter(d => d.deltaBacks > 4).map(d => ({ ...d, event: 'burst' }))}
                        dataKey="focus"
                        fill="#ef4444"
                        r={5}
                      />
                      <Scatter
                        data={chartData.filter(d => d.deltaKeys === 0 && d.deltaBacks === 0).map(d => ({ ...d, event: 'idle' }))}
                        dataKey="focus"
                        fill="#f59e0b"
                        r={4}
                      />
                      {/* Reference lines */}
                      <ReferenceLine y={75} stroke="#10b981" strokeDasharray="4 4" strokeOpacity={0.4} />
                      <ReferenceLine y={40} stroke="#ef4444" strokeDasharray="4 4" strokeOpacity={0.3} />
                    </ComposedChart>
                  </ResponsiveContainer>

                  {/* Legend */}
                  <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <span className="inline-block w-3 h-1 rounded bg-teal-400" style={{background:'#14b8a6'}} />
                      Focus %
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="inline-block w-2 h-2 rounded-full bg-red-400" style={{background:'#ef4444'}} />
                      Deletion burst
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="inline-block w-2 h-2 rounded-full" style={{background:'#f59e0b'}} />
                      Idle interval
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="inline-block w-3 border-t border-dashed" style={{borderColor:'#10b981'}} />
                      75% line
                    </span>
                  </div>

                  {/* Stats row */}
                  <div className="grid grid-cols-5 gap-2 mt-4">
                    {[
                      { label: 'Duration', value: duration },
                      { label: 'Avg Focus', value: `${Math.round(avgFocus || 0)}%` },
                      { label: 'Peak', value: `${Math.round(peakFocus || 0)}%` },
                      { label: 'Low', value: `${Math.round(lowestFocus || 0)}%` },
                      { label: 'Idle intervals', value: String(Math.round(idleCount || 0)) },
                    ].map(stat => (
                      <div key={stat.label} className="text-center p-2 rounded-lg bg-white/5 border border-white/10">
                        <div className="text-sm font-semibold" style={{
                          color: stat.label === 'Avg Focus'
                            ? (avgFocus >= 75 ? '#10b981' : avgFocus >= 50 ? '#f59e0b' : '#ef4444')
                            : 'inherit'
                        }}>
                          {stat.value}
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">{stat.label}</div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      </main>
    </div>
  );
};

export default Result;
