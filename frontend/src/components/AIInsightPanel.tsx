import type { AssessmentReport } from "@/hooks/useAssessmentSession";
import { struggleScore } from "@/hooks/useAssessmentSession";

type Props = {
  report: AssessmentReport;
};

const labelSkill = (skill: string) => {
  if (skill === "problemSolving") return "Problem Solving";
  if (skill === "debugging") return "Debugging";
  if (skill === "focus") return "Focus";
  if (skill === "planning") return "Planning";
  if (skill === "adaptability") return "Adaptability";
  return skill;
};

export default function AIInsightPanel({ report }: Props) {
  const { skillScores, heatmap, behaviorTimeline, insights } = report;
  const sortedTimeline = [...behaviorTimeline].sort((a, b) => Number(a.timestamp) - Number(b.timestamp));

  const skillEntries = Object.entries(skillScores) as [string, number][];
  const worstSkill = [...skillEntries].sort((a, b) => a[1] - b[1])[0];
  const bestSkill = [...skillEntries].sort((a, b) => b[1] - a[1])[0];

  const chartData = sortedTimeline.map((p, i) => {
    const prev = sortedTimeline[i - 1];
    return {
      deltaBackspaces: prev ? p.backspaces - prev.backspaces : p.backspaces,
      deltaKeys: prev ? p.keystrokes - prev.keystrokes : p.keystrokes,
      focus: p.focus,
    };
  });

  const deletionBursts = chartData.filter((d) => d.deltaBackspaces > 4).length;
  const idlePauses = chartData.filter((d) => d.deltaKeys < 2).length;
  const flowZones = chartData.filter((d) => d.focus > 82 && d.deltaKeys > 7).length;
  const avgFocus = Math.round(chartData.reduce((s, d) => s + d.focus, 0) / Math.max(1, chartData.length));

  const timelineDurationSec = sortedTimeline.length > 1
    ? Math.round((sortedTimeline[sortedTimeline.length - 1].timestamp - sortedTimeline[0].timestamp) / 1000)
    : 0;
  const heatmapDurationSec = Math.round(heatmap.reduce((sum, metric) => sum + Number(metric.timeMs || 0), 0) / 1000);
  const sessionDurationSec = Math.max(0, timelineDurationSec || heatmapDurationSec);

  const hardestLine = [...heatmap].sort((a, b) => struggleScore(b) - struggleScore(a))[0];
  const totalBackspaces = heatmap.reduce((s, m) => s + m.backspaces, 0);
  const hasVisualData = behaviorTimeline.length > 0 || heatmap.length > 0;

  const strengthLines: string[] = [];
  strengthLines.push(`Your ${labelSkill(bestSkill[0])} scored ${Math.round(bestSkill[1])}/100`);
  if (flowZones > 2) strengthLines.push(`You entered deep focus ${flowZones} times`);
  if (totalBackspaces < 5) strengthLines.push("Very clean code — minimal backtracking");
  if (avgFocus > 75) strengthLines.push(`Sustained ${avgFocus}% average focus`);
  if (strengthLines.length === 1 && insights.strengths[0]) strengthLines.push(insights.strengths[0]);

  const growthLines: string[] = [];
  growthLines.push(`Your ${labelSkill(worstSkill[0])} score was ${Math.round(worstSkill[1])}/100 — your lowest dimension this session`);
  if (deletionBursts > 2) {
    growthLines.push(`${deletionBursts} deletion bursts detected — try planning with pseudocode before writing`);
  }
  if (hardestLine) {
    growthLines.push(`Line ${hardestLine.line} had your highest struggle score (${struggleScore(hardestLine).toFixed(1)}) — review that logic`);
  }
  if (idlePauses > 3) {
    growthLines.push(`${idlePauses} thinking pauses recorded — consider breaking the problem into smaller steps first`);
  }

  const showSummary =
    Boolean(insights.summary) &&
    !String(insights.summary).includes("Telemetry fallback report.");

  return (
    <div className="glass-card rounded-card border border-border p-5">
      <h3 className="font-semibold mb-3">AI Insights</h3>

      {hasVisualData && (
        <div className="mb-4">
          <p className="text-xs text-muted-foreground mb-2">Session Stats</p>
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="rounded-card border border-border px-2 py-1">⏱ Duration: {sessionDurationSec > 0 ? `${Math.floor(sessionDurationSec / 60)}m ${sessionDurationSec % 60}s` : "–"}</span>
            <span className="rounded-card border border-border px-2 py-1">🔁 Backtracks: {totalBackspaces}</span>
            <span className="rounded-card border border-border px-2 py-1">⚡ Flow zones: {flowZones}</span>
            <span className="rounded-card border border-border px-2 py-1">⏸ Thinking pauses: {idlePauses}</span>
            <span className="rounded-card border border-border px-2 py-1">🎯 Avg focus: {avgFocus}%</span>
            <span className="rounded-card border border-border px-2 py-1">🔥 Hardest line: {hardestLine ? `Line ${hardestLine.line}` : "–"}</span>
          </div>
        </div>
      )}

      <div className="rounded-card border border-border p-3 mb-3" style={{ borderLeft: "3px solid #10b981" }}>
        <p className="text-xs font-semibold mb-2">💪 WHERE YOU EXCELLED</p>
        <div className="space-y-1 text-sm text-muted-foreground">
          {strengthLines.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
      </div>

      <div className="rounded-card border border-border p-3 mb-3" style={{ borderLeft: "3px solid #f59e0b" }}>
        <p className="text-xs font-semibold mb-2">🎯 FOCUS HERE NEXT</p>
        <div className="space-y-1 text-sm text-muted-foreground">
          {growthLines.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
      </div>

      <div className="text-sm text-muted-foreground italic">
        {showSummary ? `"${insights.summary}"` : "Complete more sessions for AI-generated analysis."}
      </div>
    </div>
  );
}
