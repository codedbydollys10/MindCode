import { useMemo, useState } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  XAxis,
  YAxis,
} from "recharts";
import type { BehaviorPoint, LineMetric } from "@/hooks/useAssessmentSession";

type Props = {
  timeline: BehaviorPoint[];
  heatmap: LineMetric[];
};

type EventType = "flow" | "deletion" | "idle" | "hesitation" | null;

type ChartPoint = {
  elapsedSec: number;
  charsPerSec: number;
  focus: number;
  deltaKeystrokes: number;
  deltaBackspaces: number;
  event: EventType;
  raw: BehaviorPoint;
};

const EVENT_COLORS: Record<Exclude<EventType, null>, string> = {
  flow: "#10b981",
  deletion: "#ef4444",
  idle: "#f59e0b",
  hesitation: "#a78bfa",
};

const EVENT_LABELS: Record<Exclude<EventType, null>, string> = {
  flow: "Flow",
  deletion: "Deletion Burst",
  idle: "Thinking Pause",
  hesitation: "Hesitation",
};

const formatDuration = (seconds: number) => {
  const mins = Math.floor(seconds / 60);
  const secs = Math.max(0, seconds % 60);
  return `${mins}m ${secs}s`;
};

const EventDot = (props: any) => {
  const { cx, cy, payload } = props;
  const event = payload?.event as EventType;
  if (!event || cx == null || cy == null) return null;

  return <circle cx={cx} cy={cy} r={5} fill={EVENT_COLORS[event]} stroke="#1e293b" strokeWidth={1} />;
};

export default function BehavioralTimeline({ timeline, heatmap }: Props) {
  const [hovered, setHovered] = useState<ChartPoint | null>(null);

  void heatmap;

  const chartData = useMemo<ChartPoint[]>(() => {
    if (!timeline.length) return [];
    const sortedTimeline = [...timeline]
      .filter((point) => Number.isFinite(Number(point?.timestamp)))
      .sort((a, b) => Number(a.timestamp) - Number(b.timestamp));
    if (!sortedTimeline.length) return [];

    return sortedTimeline.map((point, i) => {
      const prev = sortedTimeline[i - 1];
      const deltaKeystrokes = prev ? point.keystrokes - prev.keystrokes : point.keystrokes;
      const deltaBackspaces = prev ? point.backspaces - prev.backspaces : point.backspaces;
      const deltaSeconds = prev ? Math.max(1, (point.timestamp - prev.timestamp) / 1000) : 1;
      const charsPerSec = parseFloat((Math.max(0, deltaKeystrokes) / deltaSeconds).toFixed(2));
      const elapsedSec = Math.round((point.timestamp - sortedTimeline[0].timestamp) / 1000);

      let event: EventType = null;
      if (deltaBackspaces > 4) event = "deletion";
      else if (deltaKeystrokes < 2) event = "idle";
      else if (point.focus > 82 && charsPerSec > 1.5) event = "flow";
      else if (point.focus < 55) event = "hesitation";

      return {
        elapsedSec,
        charsPerSec,
        focus: point.focus,
        deltaKeystrokes,
        deltaBackspaces,
        event,
        raw: point,
      };
    });
  }, [timeline]);

  const summary = useMemo(() => {
    if (!chartData.length) {
      return {
        durationSec: 0,
        peakSpeed: 0,
        avgFocus: 0,
        flowZones: 0,
        idlePauses: 0,
        deletionBursts: 0,
        activePct: 0,
      };
    }

    const durationSec = Math.max(0, chartData[chartData.length - 1].elapsedSec);
    const peakSpeed = Math.max(...chartData.map((d) => d.charsPerSec));
    const avgFocus = Math.round(chartData.reduce((sum, d) => sum + d.focus, 0) / Math.max(1, chartData.length));
    const flowZones = chartData.filter((d) => d.event === "flow").length;
    const idlePauses = chartData.filter((d) => d.event === "idle").length;
    const deletionBursts = chartData.filter((d) => d.event === "deletion").length;
    const activeCount = chartData.filter((d) => d.event !== "idle").length;
    const activePct = Math.round((activeCount / Math.max(1, chartData.length)) * 100);

    return {
      durationSec,
      peakSpeed,
      avgFocus,
      flowZones,
      idlePauses,
      deletionBursts,
      activePct,
    };
  }, [chartData]);

  const maxY = useMemo(() => {
    if (!chartData.length) return 5;
    return Math.max(5, ...chartData.map((d) => d.charsPerSec)) + 2;
  }, [chartData]);

  const eventPoints = useMemo(() => chartData.filter((d) => d.event !== null), [chartData]);

  return (
    <div className="glass-card rounded-card border border-border p-5 lg:col-span-2">
      <h3 className="font-semibold mb-3">Behavior Timeline</h3>

      {timeline.length === 0 ? (
        <div className="rounded-card border border-border p-5">
          <div className="h-44 rounded-card border border-border opacity-50" />
          <p className="text-muted-foreground text-sm mt-3">
            Timeline recorded during live assessment only.
            <br />
            Complete a new session to see your behavioral chart.
          </p>
        </div>
      ) : (
        <>
          <div className="flex gap-4">
            <div className="flex-[3] min-w-0">
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart
                    data={chartData}
                    onMouseMove={(state: any) => {
                      if (state?.activePayload?.[0]?.payload) {
                        setHovered(state.activePayload[0].payload as ChartPoint);
                      }
                    }}
                    onMouseLeave={() => setHovered(null)}
                  >
                    <defs>
                      <linearGradient id="tlGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#14b8a6" stopOpacity={0.45} />
                        <stop offset="95%" stopColor="#14b8a6" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>

                    <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" />
                    <ReferenceLine y={0} stroke="#1e293b" />
                    <XAxis
                      dataKey="elapsedSec"
                      tickFormatter={(v: number) => (v >= 60 ? `${Math.floor(v / 60)}m${v % 60}s` : `${v}s`)}
                      tick={{ fill: "#64748b", fontSize: 11 }}
                    />
                    <YAxis
                      domain={[0, maxY]}
                      tickFormatter={(v: number) => `${v}`}
                      tick={{ fill: "#64748b", fontSize: 11 }}
                      label={{ value: "chars/sec", angle: -90, position: "insideLeft", fill: "#64748b", fontSize: 10 }}
                    />

                    <Area
                      dataKey="charsPerSec"
                      fill="url(#tlGrad)"
                      stroke="transparent"
                      isAnimationActive={false}
                      strokeWidth={0}
                      dot={false}
                      type="monotone"
                    />

                    <Line
                      dataKey="charsPerSec"
                      stroke="#14b8a6"
                      strokeWidth={2}
                      isAnimationActive={false}
                      dot={false}
                      type="monotone"
                    />

                    <Scatter data={eventPoints} dataKey="charsPerSec" shape={<EventDot />} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="w-44 shrink-0">
              <div className="rounded-card border border-border p-3 text-xs space-y-2">
                {hovered ? (
                  <>
                    <p className="font-semibold text-teal">t = {hovered.elapsedSec}s</p>
                    <p>Speed: {hovered.charsPerSec} chars/sec</p>
                    <p>Focus: {hovered.focus}%</p>
                    <p>Keys typed: {Math.max(0, hovered.deltaKeystrokes)}</p>
                    <p>Backspaces: {Math.max(0, hovered.deltaBackspaces)}</p>
                    <p>Event: {hovered.event ? EVENT_LABELS[hovered.event] : "Normal coding"}</p>

                    {hovered.event === "flow" && <p style={{ color: "#10b981" }}>Peak concentration zone</p>}
                    {hovered.event === "deletion" && <p style={{ color: "#f59e0b" }}>Rethinking approach — high deletions</p>}
                    {hovered.event === "idle" && <p style={{ color: "#3b82f6" }}>Thinking pause</p>}
                    {hovered.event === "hesitation" && <p style={{ color: "#a78bfa" }}>Hesitation detected</p>}
                  </>
                ) : (
                  <>
                    <p>Duration: {formatDuration(summary.durationSec)}</p>
                    <p>Peak speed: {summary.peakSpeed.toFixed(1)} chars/sec</p>
                    <p>Avg focus: {summary.avgFocus}%</p>
                    <p>Flow zones: {summary.flowZones}</p>
                    <p>Idle pauses: {summary.idlePauses}</p>
                    <p>Deletion bursts: {summary.deletionBursts}</p>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: EVENT_COLORS.flow }} />Flow</span>
            <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: EVENT_COLORS.deletion }} />Deletion Burst</span>
            <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: EVENT_COLORS.idle }} />Thinking Pause</span>
            <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: EVENT_COLORS.hesitation }} />Hesitation</span>
          </div>

          <div className="mt-3">
            <p className="text-xs text-muted-foreground mb-1">Active {summary.activePct}% · Idle {100 - summary.activePct}%</p>
            <div className="h-2 rounded bg-background overflow-hidden flex">
              <div className="h-full" style={{ width: `${summary.activePct}%`, backgroundColor: "#14b8a6" }} />
              <div className="h-full" style={{ width: `${100 - summary.activePct}%`, backgroundColor: "#334155" }} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
