import { jsPDF } from "jspdf";
import type { AssessmentReport, BehaviorPoint } from "@/hooks/useAssessmentSession";
import { getSupabaseClient, hasSupabaseEnv } from "@/lib/supabase";

// ─── Types ────────────────────────────────────────────────────────────────────

type ReportNarrative = {
  summary: string;
  conclusion: string;
  strengths: string[];
  improvements: string[];
};

type ReportAnalytics = {
  durationSec: number;
  avgFocus: number;
  peakFocus: number;
  lowFocus: number;
  totalKeystrokes: number;
  totalBackspaces: number;
  idleIntervals: number;
  deletionBursts: number;
  strongestSkill: { name: string; value: number };
  weakestSkill: { name: string; value: number };
};

// ─── Design Tokens (white-theme) ─────────────────────────────────────────────

const C = {
  white:       [255, 255, 255] as const,
  pageBg:      [248, 250, 252] as const,   // slate-50
  headerBg:    [15,  23,  42]  as const,   // slate-900
  headerText:  [255, 255, 255] as const,
  accent:      [20,  184, 166] as const,   // teal-500
  accentDark:  [13,  148, 136] as const,   // teal-600
  sectionHead: [15,  23,  42]  as const,   // slate-900
  bodyText:    [30,  41,  59]  as const,   // slate-800
  mutedText:   [100, 116, 139] as const,   // slate-500
  border:      [203, 213, 225] as const,   // slate-300
  cardBg:      [241, 245, 249] as const,   // slate-100
  greenBg:     [220, 252, 231] as const,   // green-100
  greenText:   [21,  128, 61]  as const,   // green-700
  amberBg:     [254, 243, 199] as const,   // amber-100
  amberText:   [146, 64,  14]  as const,   // amber-800
  redBg:       [254, 226, 226] as const,   // red-100
  redText:     [185, 28,  28]  as const,   // red-700
  blueBg:      [219, 234, 254] as const,   // blue-100
  blueText:    [29,  78,  216] as const,   // blue-700
};

const PAGE_W = 210;
const PAGE_H = 297;
const MARGIN = 14;
const CONTENT_W = PAGE_W - MARGIN * 2;

// ─── Helpers ──────────────────────────────────────────────────────────────────

const sf = (doc: jsPDF, rgb: readonly [number, number, number]) => doc.setFillColor(rgb[0], rgb[1], rgb[2]);
const sd = (doc: jsPDF, rgb: readonly [number, number, number]) => doc.setDrawColor(rgb[0], rgb[1], rgb[2]);
const st = (doc: jsPDF, rgb: readonly [number, number, number]) => doc.setTextColor(rgb[0], rgb[1], rgb[2]);

const normalizeText = (v: unknown) => String(v || "").replace(/\s+/g, " ").trim();
const uniqueNormalized = (items: string[]) => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of items) {
    const t = normalizeText(raw);
    if (!t) continue;
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
};
const compactStrengthLine = (value: string) =>
  normalizeText(value)
    .replace(/\s*[-—–]\s*highest score this session\.?$/i, "")
    .replace(/\s*was your strongest dimension\.?$/i, "")
    .replace(/\s*dimension\.?$/i, "");

const skillEntries = (report: AssessmentReport) => [
  { name: "Problem Solving", value: Number(report.skillScores?.problemSolving || 0) },
  { name: "Debugging",       value: Number(report.skillScores?.debugging      || 0) },
  { name: "Focus",           value: Number(report.skillScores?.focus          || 0) },
  { name: "Planning",        value: Number(report.skillScores?.planning       || 0) },
  { name: "Adaptability",    value: Number(report.skillScores?.adaptability   || 0) },
];

const toSafeTimeline = (timeline: BehaviorPoint[] = []) =>
  [...timeline]
    .filter((p) => Number.isFinite(Number(p?.timestamp)))
    .sort((a, b) => Number(a.timestamp) - Number(b.timestamp));

// ─── Analytics ────────────────────────────────────────────────────────────────

const computeAnalytics = (report: AssessmentReport): ReportAnalytics => {
  const timeline = toSafeTimeline(report.behaviorTimeline || []);
  const first = timeline[0];
  const last  = timeline[timeline.length - 1];

  const durationSec =
    timeline.length > 1
      ? Math.max(0, Math.round((Number(last.timestamp) - Number(first.timestamp)) / 1000))
      : 0;

  const focusValues = timeline.map((p) => Number(p.focus || 0));
  const avgFocus  = focusValues.length ? Math.round(focusValues.reduce((s, v) => s + v, 0) / focusValues.length) : 0;
  const peakFocus = focusValues.length ? Math.max(...focusValues) : 0;
  const lowFocus  = focusValues.length ? Math.min(...focusValues) : 0;

  const totalKeystrokes =
    timeline.length > 1
      ? Math.max(0, Number(last.keystrokes || 0) - Number(first.keystrokes || 0))
      : Math.max(0, Number(last?.keystrokes || 0));

  const totalBackspaces =
    timeline.length > 1
      ? Math.max(0, Number(last.backspaces || 0) - Number(first.backspaces || 0))
      : Math.max(0, Number(last?.backspaces || 0));

  let idleIntervals = 0;
  let deletionBursts = 0;
  for (let i = 0; i < timeline.length; i++) {
    const prev = timeline[i - 1];
    const deltaKeys  = prev ? Math.max(0, Number(timeline[i].keystrokes || 0) - Number(prev.keystrokes || 0)) : Number(timeline[i].keystrokes || 0);
    const deltaBacks = prev ? Math.max(0, Number(timeline[i].backspaces || 0) - Number(prev.backspaces || 0)) : Number(timeline[i].backspaces || 0);
    if (deltaKeys === 0 && deltaBacks === 0) idleIntervals++;
    if (deltaBacks > 4) deletionBursts++;
  }

  const skills = skillEntries(report);
  const strongestSkill = [...skills].sort((a, b) => b.value - a.value)[0] || { name: "Focus", value: 0 };
  const weakestSkill   = [...skills].sort((a, b) => a.value - b.value)[0] || { name: "Focus", value: 0 };

  return {
    durationSec, avgFocus, peakFocus, lowFocus,
    totalKeystrokes, totalBackspaces, idleIntervals, deletionBursts,
    strongestSkill, weakestSkill,
  };
};

// ─── AI Narrative (Bytez via backend) ────────────────────────────────────────

const fetchBytezNarrative = async (report: AssessmentReport, a: ReportAnalytics): Promise<ReportNarrative | null> => {
  if (!hasSupabaseEnv || !report?.testId) return null;
  try {
    const supa = getSupabaseClient();
    const { data: { user } } = await supa.auth.getUser();
    const userId = user?.id;
    if (!userId) return null;

    const API = (import.meta.env.VITE_CODE_RUNNER_URL as string | undefined) || "https://mind-code-gilt.vercel.app";
    const response = await fetch(`${API}/generate-recommendations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_id: userId,
        test_id: report.testId,
        language: report.language,
        scores: {
          problemSolving: Number(report.skillScores?.problemSolving || 0),
          debugging: Number(report.skillScores?.debugging || 0),
          focus: Number(report.skillScores?.focus || 0),
          planning: Number(report.skillScores?.planning || 0),
          flexibility: Number(report.skillScores?.adaptability || 0),
        },
      }),
    });

    if (!response.ok) return null;
    const data = await response.json();
    const summary = normalizeText(data?.behavioral_story || data?.headline || "");
    const conclusion = normalizeText(data?.personalized_feedback || "");
    const strengths = uniqueNormalized([
      normalizeText(data?.strength_note || ""),
      ...(Array.isArray(report?.insights?.strengths) ? report.insights.strengths.map(normalizeText) : []),
    ]).map(compactStrengthLine).slice(0, 3);
    const improvements = uniqueNormalized([
      ...(Array.isArray(data?.growth_areas)
        ? data.growth_areas.map((g: { fix?: string; why_weak?: string }) => normalizeText(g.fix || g.why_weak || ""))
        : []),
      ...(Array.isArray(report?.insights?.weaknesses) ? report.insights.weaknesses.map(normalizeText) : []),
    ]).slice(0, 3);
    if (!summary || !conclusion) return null;
    return { summary, conclusion, strengths, improvements };
  } catch {
    return null;
  }
};

const localNarrative = (report: AssessmentReport, a: ReportAnalytics): ReportNarrative => {
  const outcome =
    report.runVerdict?.passed === true  ? "successfully passed the sample run" :
    report.runVerdict?.passed === false ? "encountered output mismatches in the sample run" :
    "completed the session without a definitive run verdict";

  const resultSummary = normalizeText(report.insights?.summary || "");
  const summary = resultSummary
    ? `${resultSummary}. Session telemetry recorded ${a.totalKeystrokes} keystrokes, ${a.totalBackspaces} backspaces, and ${a.avgFocus}% average focus over ${Math.round(a.durationSec / 60)}m ${a.durationSec % 60}s.`
    : `The candidate ${outcome} for "${report.problemTitle}" (${report.language?.toUpperCase()}, ${report.difficulty}). ` +
    `The ${Math.round(a.durationSec / 60)}-minute session maintained an average focus of ${a.avgFocus}%, with ${a.totalKeystrokes} total keystrokes recorded. ` +
    `Behavioural telemetry indicates ${a.deletionBursts} deletion burst(s) and ${a.idleIntervals} idle interval(s) across the session.`;

  const conclusion = `Performance was strongest in ${a.strongestSkill.name} (${Math.round(a.strongestSkill.value)}%) and requires further development in ${a.weakestSkill.name} (${Math.round(a.weakestSkill.value)}%). ` +
    `A follow-up attempt at the same difficulty is recommended, targeting fewer than ${Math.max(1, Math.round(a.totalBackspaces * 0.8))} backspaces and an average focus above ${Math.min(90, a.avgFocus + 6)}%.`;

  const strengths    = uniqueNormalized((report.insights?.strengths || []).map(normalizeText)).map(compactStrengthLine).slice(0, 3);
  const improvements = uniqueNormalized((report.insights?.weaknesses || []).map(normalizeText)).slice(0, 3);

  return {
    summary,
    conclusion,
    strengths:    strengths.length    ? strengths    : [`Strong ${a.strongestSkill.name} dimension`, "Consistent keystroke cadence"],
    improvements: improvements.length ? improvements : [`Improve ${a.weakestSkill.name} score`, "Reduce deletion bursts during implementation"],
  };
};

const resolveNarrative = async (report: AssessmentReport, a: ReportAnalytics): Promise<ReportNarrative> =>
  (await fetchBytezNarrative(report, a)) || localNarrative(report, a);

// ─── Drawing Primitives ───────────────────────────────────────────────────────

/** Render wrapped body text; returns the Y position after the last line. */
const drawBody = (doc: jsPDF, text: string, x: number, y: number, maxW = CONTENT_W, lineH = 4.8): number => {
  const lines = doc.splitTextToSize(normalizeText(text), maxW);
  st(doc, C.bodyText);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.text(lines, x, y);
  return y + lines.length * lineH;
};

/** Render wrapped body text with max line limit; prevents section overlap. */
const drawBodyClamped = (
  doc: jsPDF,
  text: string,
  x: number,
  y: number,
  maxW = CONTENT_W,
  lineH = 4.8,
  maxLines = 6,
): number => {
  const lines = doc.splitTextToSize(normalizeText(text), maxW) as string[];
  const trimmed = lines.slice(0, Math.max(1, maxLines));
  if (lines.length > trimmed.length && trimmed.length > 0) {
    const last = trimmed[trimmed.length - 1];
    trimmed[trimmed.length - 1] = `${String(last).replace(/\.*\s*$/, "")}...`;
  }
  st(doc, C.bodyText);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.text(trimmed, x, y);
  return y + trimmed.length * lineH;
};

/** Thin horizontal rule. */
const rule = (doc: jsPDF, y: number, x1 = MARGIN, x2 = PAGE_W - MARGIN) => {
  sd(doc, C.border);
  doc.setLineWidth(0.25);
  doc.line(x1, y, x2, y);
};

/** Section heading with accent underline. */
const sectionHead = (doc: jsPDF, title: string, y: number): number => {
  st(doc, C.sectionHead);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text(title.toUpperCase(), MARGIN, y);
  sf(doc, C.accent);
  doc.rect(MARGIN, y + 1.2, 20, 0.8, "F");
  return y + 7;
};

/** Section heading with configurable x-position (for multi-column layouts). */
const sectionHeadAt = (doc: jsPDF, title: string, x: number, y: number, underlineW = 20): number => {
  st(doc, C.sectionHead);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text(title.toUpperCase(), x, y);
  sf(doc, C.accent);
  doc.rect(x, y + 1.2, underlineW, 0.8, "F");
  return y + 7;
};

/** Small pill badge. */
const badge = (
  doc: jsPDF,
  label: string,
  x: number, y: number,
  bgColor: readonly [number, number, number],
  textColor: readonly [number, number, number],
  w = 28, h = 7,
) => {
  sf(doc, bgColor);
  doc.roundedRect(x, y, w, h, 1.5, 1.5, "F");
  st(doc, textColor);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  doc.text(label, x + w / 2, y + 4.8, { align: "center" });
};

// ─── Behaviour Timeline Canvas ────────────────────────────────────────────────

const renderTimelineImage = (timeline: BehaviorPoint[]): string | null => {
  if (typeof document === "undefined") return null;

  const points = toSafeTimeline(timeline);
  const CW = 860, CH = 180;
  const canvas = document.createElement("canvas");
  canvas.width = CW;
  canvas.height = CH;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  // White background
  ctx.fillStyle = "#f8fafc";
  ctx.fillRect(0, 0, CW, CH);

  if (!points.length) {
    ctx.fillStyle = "#94a3b8";
    ctx.font = "14px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("No timeline data available", CW / 2, CH / 2);
    return canvas.toDataURL("image/png");
  }

  const pad = { left: 44, right: 16, top: 12, bottom: 32 };
  const W = CW - pad.left - pad.right;
  const H = CH - pad.top - pad.bottom;

  const t0 = Number(points[0].timestamp);
  const t1 = Number(points[points.length - 1].timestamp);
  const dt = Math.max(1, t1 - t0);

  const xOf = (ts: number) => pad.left + ((ts - t0) / dt) * W;
  const yOf = (v: number)  => pad.top + H - (Math.max(0, Math.min(100, v)) / 100) * H;

  // Grid lines & y-axis labels
  ctx.strokeStyle = "#e2e8f0";
  ctx.lineWidth = 1;
  ctx.fillStyle = "#94a3b8";
  ctx.font = "11px sans-serif";
  ctx.textAlign = "right";
  [0, 25, 50, 75, 100].forEach((tick) => {
    const y = yOf(tick);
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(pad.left + W, y);
    ctx.stroke();
    ctx.fillText(`${tick}%`, pad.left - 6, y + 4);
  });

  // x-axis time markers
  ctx.textAlign = "center";
  ctx.fillStyle = "#94a3b8";
  ctx.font = "10px sans-serif";
  const durationMin = dt / 60000;
  const xTicks = Math.min(6, Math.max(2, Math.floor(durationMin)));
  for (let i = 0; i <= xTicks; i++) {
    const fracT = i / xTicks;
    const xPos = pad.left + fracT * W;
    const mins = Math.round((fracT * dt) / 60000);
    ctx.fillText(`${mins}m`, xPos, CH - 8);
  }

  // Area fill
  ctx.beginPath();
  ctx.moveTo(xOf(Number(points[0].timestamp)), yOf(Number(points[0].focus || 0)));
  points.forEach((p) => ctx.lineTo(xOf(Number(p.timestamp)), yOf(Number(p.focus || 0))));
  ctx.lineTo(xOf(Number(points[points.length - 1].timestamp)), pad.top + H);
  ctx.lineTo(pad.left, pad.top + H);
  ctx.closePath();
  const grad = ctx.createLinearGradient(0, pad.top, 0, pad.top + H);
  grad.addColorStop(0, "rgba(20,184,166,0.18)");
  grad.addColorStop(1, "rgba(20,184,166,0.00)");
  ctx.fillStyle = grad;
  ctx.fill();

  // Focus line
  ctx.beginPath();
  ctx.strokeStyle = "#0d9488";
  ctx.lineWidth = 2;
  points.forEach((p, i) => {
    const x = xOf(Number(p.timestamp));
    const y = yOf(Number(p.focus || 0));
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.stroke();

  // Axis label
  ctx.fillStyle = "#0d9488";
  ctx.font = "bold 11px sans-serif";
  ctx.textAlign = "left";
  ctx.fillText("Focus (%)", pad.left + 4, 11);

  return canvas.toDataURL("image/png");
};

// ─── Score colour helpers ─────────────────────────────────────────────────────

const scoreLabel = (v: number) => v >= 80 ? "Excellent" : v >= 60 ? "Good" : v >= 40 ? "Fair" : "Needs Work";

const scoreBadgeColors = (v: number): [readonly [number,number,number], readonly [number,number,number]] =>
  v >= 80 ? [C.greenBg, C.greenText] :
  v >= 60 ? [C.blueBg,  C.blueText]  :
  v >= 40 ? [C.amberBg, C.amberText] :
            [C.redBg,   C.redText];

// ─── Main Page Builder ────────────────────────────────────────────────────────

const drawReportPage = async (doc: jsPDF, report: AssessmentReport) => {
  const analytics  = computeAnalytics(report);
  const narrative  = await resolveNarrative(report, analytics);
  const skills     = skillEntries(report);
  const overallScore = Math.round(skills.reduce((s, sk) => s + sk.value, 0) / skills.length);

  /* ── Page background ── */
  sf(doc, C.pageBg);
  doc.rect(0, 0, PAGE_W, PAGE_H, "F");

  /* ── Header banner ── */
  sf(doc, C.headerBg);
  doc.rect(0, 0, PAGE_W, 30, "F");

  // MindCode wordmark
  sf(doc, C.accent);
  doc.roundedRect(MARGIN, 7, 36, 16, 2, 2, "F");
  st(doc, C.headerBg);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("MindCode", MARGIN + 18, 16.5, { align: "center" });

  // Report title
  st(doc, C.headerText);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text("Assessment Report", 56, 13);
  st(doc, [148, 163, 184] as const);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.text(normalizeText(report.problemTitle) || "Coding Assessment", 56, 20);
  doc.text(new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }), 56, 26);

  // Overall score circle (top-right)
  const cx = PAGE_W - 24, cy = 15;
  sf(doc, C.accent);
  doc.circle(cx, cy, 11, "F");
  st(doc, C.headerBg);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text(`${overallScore}`, cx, cy + 1.5, { align: "center" });
  st(doc, [148, 163, 184] as const);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.5);
  doc.text("SCORE", cx, cy + 6.5, { align: "center" });

  let y = 37;

  /* ── Meta strip (4 stat cards) ── */
  const verdictPassed = report.runVerdict?.passed;
  const verdictLabel  = verdictPassed === true ? "PASSED" : verdictPassed === false ? "FAILED" : "N/A";
  const verdictBg     = verdictPassed === true ? C.greenBg : verdictPassed === false ? C.redBg : C.cardBg;
  const verdictTxt    = verdictPassed === true ? C.greenText : verdictPassed === false ? C.redText : C.mutedText;

  const statCards = [
    { label: "Language",  value: String(report.language || "—").toUpperCase() },
    { label: "Difficulty",value: String(report.difficulty || "—").toUpperCase() },
    { label: "Duration",  value: `${Math.round(analytics.durationSec / 60)}m ${analytics.durationSec % 60}s` },
    { label: "Avg Focus", value: `${analytics.avgFocus}%` },
  ];

  const cw = (CONTENT_W - 3 * 3) / 4;
  statCards.forEach((card, i) => {
    const cx2 = MARGIN + i * (cw + 3);
    sf(doc, C.white);
    doc.roundedRect(cx2, y, cw, 14, 2, 2, "F");
    sd(doc, C.border);
    doc.setLineWidth(0.2);
    doc.roundedRect(cx2, y, cw, 14, 2, 2, "S");

    st(doc, C.mutedText);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.text(card.label, cx2 + cw / 2, y + 5.2, { align: "center" });

    st(doc, C.sectionHead);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text(card.value, cx2 + cw / 2, y + 11.2, { align: "center" });
  });

  // Verdict badge
  sf(doc, verdictBg);
  doc.roundedRect(PAGE_W - MARGIN - 28, y, 28, 14, 2, 2, "F");
  st(doc, verdictTxt);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text(verdictLabel, PAGE_W - MARGIN - 14, y + 9, { align: "center" });

  y += 24;

  /* ── Two-column layout ── */
  const colL = MARGIN;
  const colLW = 107;
  const colR = MARGIN + colLW + 5;
  const colRW = CONTENT_W - colLW - 5;
  const footerRuleY = PAGE_H - 10;
  const timelineImgH = 38;
  const timelineCardH = timelineImgH + 4;
  const timelineSectionY = footerRuleY - timelineCardH - 10; // fixed bottom anchor

  // ── LEFT: Summary (no heading by request) ──
  let yL = y;
  yL = drawBodyClamped(doc, narrative.summary, colL, yL + 1, colLW, 4.8, 6) + 8;

  // ── LEFT: Conclusion ──
  yL = sectionHead(doc, "Conclusion", yL) + 4;
  yL = drawBodyClamped(doc, narrative.conclusion, colL, yL, colLW, 4.8, 5) + 8;

  // ── LEFT: Strengths ──
  yL = sectionHead(doc, "Strengths", yL) + 4;
  (narrative.strengths.length ? narrative.strengths : ["No data"]).forEach((s) => {
    sf(doc, C.greenBg);
    doc.roundedRect(colL, yL - 3.5, colLW, 6.5, 1.5, 1.5, "F");
    st(doc, C.greenText);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.2);
    const truncated = doc.splitTextToSize(`✓  ${normalizeText(s)}`, colLW - 4)[0];
    doc.text(truncated, colL + 3, yL + 1.5);
    yL += 8;
  });
  yL += 4;

  // ── LEFT: Areas for Improvement (anchored just above bottom timeline) ──
  const improvementItems = narrative.improvements.length ? narrative.improvements : ["No data"];
  const improveToGraphGap = 8;
  const availableImproveHeight = Math.max(0, timelineSectionY - improveToGraphGap - (yL + 2));
  const maxImproveRowsFit = Math.max(
    1,
    Math.min(improvementItems.length, Math.floor((availableImproveHeight - 8) / 8))
  );
  const shownImprovements = improvementItems.slice(0, maxImproveRowsFit);
  const improveBlockH = 8 + shownImprovements.length * 8;
  const improveStartY = Math.max(yL + 2, timelineSectionY - improveBlockH - improveToGraphGap);

  yL = sectionHead(doc, "Areas for Improvement", improveStartY) + 4;
  shownImprovements.forEach((imp) => {
    sf(doc, C.amberBg);
    doc.roundedRect(colL, yL - 3.5, colLW, 6.5, 1.5, 1.5, "F");
    st(doc, C.amberText);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.2);
    const truncated = doc.splitTextToSize(`⚠  ${normalizeText(imp)}`, colLW - 4)[0];
    doc.text(truncated, colL + 3, yL + 1.5);
    yL += 8;
  });

  // ── RIGHT: Skill Scores Table ──
  let yR = y;
  yR = sectionHeadAt(doc, "Skill Assessment", colR, yR, 24) + 8;

  // Table header
  sf(doc, C.headerBg);
  doc.roundedRect(colR, yR, colRW, 7, 1, 1, "F");
  st(doc, C.headerText);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  doc.text("SKILL",  colR + 3,         yR + 5);
  doc.text("SCORE",  colR + colRW - 28, yR + 5, { align: "center" });
  doc.text("RATING", colR + colRW - 3,  yR + 5, { align: "right" });
  yR += 7;

  skills.forEach((skill, idx) => {
    const rowBg = idx % 2 === 0 ? C.white : C.cardBg;
    sf(doc, rowBg);
    doc.rect(colR, yR, colRW, 8, "F");
    sd(doc, C.border);
    doc.setLineWidth(0.15);
    doc.line(colR, yR + 8, colR + colRW, yR + 8);

    st(doc, C.bodyText);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text(skill.name, colR + 3, yR + 5.5);

    const scorePct = Math.round(skill.value);
    const [bgCol, txCol] = scoreBadgeColors(scorePct);
    badge(doc, `${scorePct}%`, colR + colRW - 36, yR + 0.5, bgCol, txCol, 16, 7);
    badge(doc, scoreLabel(scorePct), colR + colRW - 18, yR + 0.5, bgCol, txCol, 16, 7);

    yR += 8;
  });

  // Overall row
  sf(doc, C.headerBg);
  doc.rect(colR, yR, colRW, 8, "F");
  st(doc, C.headerText);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.text("Overall", colR + 3, yR + 5.5);
  const [oBg, oTx] = scoreBadgeColors(overallScore);
  badge(doc, `${overallScore}%`, colR + colRW - 36, yR + 0.5, oBg, oTx, 16, 7);
  badge(doc, scoreLabel(overallScore), colR + colRW - 18, yR + 0.5, oBg, oTx, 16, 7);
  yR += 12;

  // ── RIGHT: Telemetry Table ──
  st(doc, C.sectionHead);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text("SESSION TELEMETRY", colR, yR + 4.5);
  sf(doc, C.accent);
  doc.rect(colR, yR + 5.8, 24, 0.8, "F");
  yR += 9;

  const telRows = [
    ["Total Keystrokes",  String(analytics.totalKeystrokes)],
    ["Total Backspaces",  String(analytics.totalBackspaces)],
    ["Idle Intervals",    String(analytics.idleIntervals)],
    ["Deletion Bursts",   String(analytics.deletionBursts)],
    ["Peak Focus",        `${Math.round(analytics.peakFocus)}%`],
    ["Low Focus",         `${Math.round(analytics.lowFocus)}%`],
  ];

  telRows.forEach(([label, val], idx) => {
    const rowBg = idx % 2 === 0 ? C.white : C.cardBg;
    sf(doc, rowBg);
    doc.rect(colR, yR, colRW, 7, "F");
    sd(doc, C.border);
    doc.setLineWidth(0.15);
    doc.line(colR, yR + 7, colR + colRW, yR + 7);

    st(doc, C.mutedText);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.text(label, colR + 3, yR + 4.8);

    st(doc, C.sectionHead);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.text(val, colR + colRW - 3, yR + 4.8, { align: "right" });
    yR += 7;
  });

  /* ── Behaviour Timeline (full-width, compact) ── */
  const sectionY2  = sectionHead(doc, "Focus Behaviour Timeline", timelineSectionY) + 3;
  const imgH = timelineImgH;

  sf(doc, C.white);
  sd(doc, C.border);
  doc.setLineWidth(0.25);
  doc.roundedRect(MARGIN, sectionY2, CONTENT_W, imgH + 4, 2, 2, "FD");

  const timelineImg = renderTimelineImage(report.behaviorTimeline || []);
  if (timelineImg) {
    doc.addImage(timelineImg, "PNG", MARGIN + 2, sectionY2 + 2, CONTENT_W - 4, imgH);
  } else {
    st(doc, C.mutedText);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text("Timeline data unavailable", PAGE_W / 2, sectionY2 + imgH / 2, { align: "center" });
  }

  /* ── Footer ── */
  rule(doc, footerRuleY);
  st(doc, C.mutedText);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.5);
  doc.text(`Generated by MindCode  •  ${new Date().toLocaleString("en-GB")}`, MARGIN, footerRuleY + 4);
  doc.text("Confidential — For Internal Use Only", PAGE_W - MARGIN, footerRuleY + 4, { align: "right" });
};

// ─── Public API ───────────────────────────────────────────────────────────────

export async function createBrandedReportPdf(reports: AssessmentReport[]): Promise<jsPDF> {
  const safeReports = reports || [];
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  let first = true;

  for (const report of safeReports) {
    if (!first) doc.addPage();
    first = false;
    await drawReportPage(doc, report);
  }

  return doc;
}

export async function downloadBrandedReportPdf(reports: AssessmentReport[], fileName: string): Promise<void> {
  if (!reports?.length) return;
  const doc = await createBrandedReportPdf(reports);
  doc.save(fileName || "mindcode-report.pdf");
}

// Backward-compatible aliases
export async function createDetailedReportPdf(reports: AssessmentReport[]): Promise<jsPDF> {
  return createBrandedReportPdf(reports);
}

export async function downloadDetailedReportPdf(reports: AssessmentReport[], fileName = "mindcode-assessment.pdf"): Promise<void> {
  await downloadBrandedReportPdf(reports, fileName);
}
