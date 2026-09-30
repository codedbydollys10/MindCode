import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { type LineMetric, heatColor, struggleScore } from "@/hooks/useAssessmentSession";

type Props = { heatmap: LineMetric[] };

type HeatRow = {
  line: string;
  score: number;
  edits: number;
  backspaces: number;
  timeMs: number;
  raw: LineMetric;
};

const barColor = (score: number) => {
  if (score >= 4) return "#ef4444";
  if (score >= 2) return "#f59e0b";
  return "#10b981";
};

export default function HeatmapChart({ heatmap }: Props) {
  const [hovered, setHovered] = useState<HeatRow | null>(null);

  const data = useMemo<HeatRow[]>(() => {
    return heatmap
      .map((m) => ({
        line: `L${m.line}`,
        score: parseFloat(struggleScore(m).toFixed(2)),
        edits: m.edits,
        backspaces: m.backspaces,
        timeMs: m.timeMs,
        raw: m,
      }))
      .sort((a, b) => a.raw.line - b.raw.line);
  }, [heatmap]);

  const chartHeight = useMemo(() => Math.max(220, data.length * 24), [data.length]);
  const maxScore = useMemo(
    () => Math.max(1, ...data.map((entry) => Number(entry.score || 0))),
    [data]
  );

  return (
    <div className="glass-card rounded-card border border-border p-5">
      <h3 className="font-semibold mb-3">Code Heatmap</h3>

      {heatmap.length === 0 ? (
        <p className="text-muted-foreground text-sm">No line edits recorded for this session.</p>
      ) : (
        <>
          <div className="flex gap-4">
            <div className="flex-[3] min-w-0">
              <div className="h-56 overflow-y-auto pr-2">
                <div style={{ height: chartHeight }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data} layout="vertical" margin={{ left: 8, right: 10, top: 4, bottom: 4 }}>
                      <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" />
                      <YAxis
                        dataKey="line"
                        type="category"
                        width={42}
                        tick={{ fill: "#94a3b8", fontSize: 11 }}
                      />
                      <XAxis
                        type="number"
                        domain={[0, "auto"]}
                        tick={{ fill: "#64748b", fontSize: 10 }}
                      />

                      <Bar dataKey="score" radius={[0, 4, 4, 0]} minPointSize={2}>
                        {data.map((entry, idx) => (
                          <Cell
                            key={`${entry.line}-${idx}`}
                            fill={barColor(entry.score)}
                            className={heatColor(entry.raw)}
                            onMouseEnter={() => setHovered(entry)}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>

            <div className="w-44 shrink-0">
              <div className="rounded-card border border-border p-3 text-xs space-y-2">
                {hovered ? (
                  <>
                    <p>Line: {hovered.raw.line}</p>
                    <p>Struggle Score: {hovered.score.toFixed(2)}</p>
                    <p>Time on line: {(hovered.timeMs / 1000).toFixed(1)}s</p>
                    <p>Edits: {hovered.edits}</p>
                    <p>Backspaces: {hovered.backspaces}</p>
                    <p>Errors: {hovered.raw.errors}</p>
                    <p>
                      {hovered.score >= 4
                        ? "⚠ High struggle — review this logic"
                        : hovered.score >= 2
                          ? "⚡ Moderate effort"
                          : "✓ Handled confidently"}
                    </p>
                  </>
                ) : (
                  <p className="text-muted-foreground">Hover a line to inspect detail.</p>
                )}
              </div>
            </div>
          </div>

          <div className="mt-4 rounded-card border border-border p-3">
            <p className="text-xs text-muted-foreground mb-2">Per-line struggle bars</p>
            <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
              {data.map((entry) => {
                const isHovered = hovered?.raw.line === entry.raw.line;
                const widthPct = Math.max(2, Math.min(100, (entry.score / maxScore) * 100));
                return (
                  <div
                    key={`line-row-${entry.raw.line}`}
                    className="rounded-card border border-border p-2 bg-background/40"
                    onMouseEnter={() => setHovered(entry)}
                  >
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium">{entry.line}</span>
                      <span className="text-muted-foreground">{entry.score.toFixed(2)}</span>
                    </div>
                    <div className="mt-1 h-2 rounded-full bg-bg-hover overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-300"
                        style={{ width: `${widthPct}%`, backgroundColor: barColor(entry.score) }}
                      />
                    </div>
                    {isHovered && (
                      <p className="text-xs text-muted-foreground mt-2">
                        {entry.score >= 4
                          ? `Line ${entry.raw.line} shows high struggle: ${entry.backspaces} backspaces, ${entry.edits} edits, ${(entry.timeMs / 1000).toFixed(1)}s spent.`
                          : entry.score >= 2
                            ? `Line ${entry.raw.line} is moderate effort: ${entry.edits} edits and ${entry.backspaces} corrections.`
                            : `Line ${entry.raw.line} is stable with low friction and ${(entry.timeMs / 1000).toFixed(1)}s spent.`}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
