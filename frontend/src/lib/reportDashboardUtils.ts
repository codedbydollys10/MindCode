import type { AssessmentReport } from "@/hooks/useAssessmentSession";

export type ReportDateFilter = "all" | "7days" | "30days" | "year";
export type ReportFocusFilter = "all" | "high" | "medium" | "low";
export type ReportSort = "newest" | "oldest" | "focus-high" | "focus-low" | "problem" | "language";

export type ReportFilters = {
  query: string;
  language: string;
  date: ReportDateFilter;
  focus: ReportFocusFilter;
  sort: ReportSort;
  now?: number;
};

export const getReportFocus = (report: AssessmentReport) => {
  if (report.focusScoreAvailable === false) return null;
  const rawFocus = report.skillScores?.focus;
  if (rawFocus === null || rawFocus === undefined || (typeof rawFocus === "string" && !rawFocus.trim())) return null;
  const focus = Number(rawFocus);
  return Number.isFinite(focus) && focus >= 0 && focus <= 100 ? Math.round(focus) : null;
};

export const getReportLanguage = (report: AssessmentReport) =>
  report.languageAvailable === false ? "" : report.language.trim();

export const getReportMetrics = (reports: AssessmentReport[]) => {
  const focusScores = reports.map(getReportFocus).filter((score): score is number => score !== null);
  return {
    totalReports: reports.length,
    averageFocus: focusScores.length
      ? Math.round(focusScores.reduce((sum, score) => sum + score, 0) / focusScores.length)
      : null,
    languageCount: new Set(reports.map(getReportLanguage).map((language) => language.toLowerCase()).filter(Boolean)).size,
    latestReport: [...reports].sort((a, b) => b.createdAt - a.createdAt)[0] || null,
  };
};

const matchesDate = (timestamp: number, filter: ReportDateFilter, now: number) => {
  if (filter === "all") return true;
  const today = new Date(now);
  today.setHours(23, 59, 59, 999);
  if (timestamp > today.getTime()) return false;
  if (filter === "7days" || filter === "30days") {
    const start = new Date(today);
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - (filter === "7days" ? 6 : 29));
    return timestamp >= start.getTime();
  }
  const date = new Date(timestamp);
  return date.getFullYear() === today.getFullYear();
};

export const filterAndSortReports = (reports: AssessmentReport[], filters: ReportFilters) => {
  const query = filters.query.trim().toLocaleLowerCase();
  const now = filters.now ?? Date.now();
  const filtered = reports.filter((report) => {
    const focus = getReportFocus(report);
    if (filters.language !== "all" && getReportLanguage(report).toLowerCase() !== filters.language) return false;
    if (!matchesDate(report.createdAt, filters.date, now)) return false;
    if (filters.focus === "high" && (focus === null || focus < 80)) return false;
    if (filters.focus === "medium" && (focus === null || focus < 50 || focus >= 80)) return false;
    if (filters.focus === "low" && (focus === null || focus >= 50)) return false;
    if (!query) return true;
    const searchable = [
      report.id,
      report.problemTitle,
      getReportLanguage(report),
      report.difficulty,
      new Date(report.createdAt).toLocaleDateString(),
      report.insights.summary,
      ...report.insights.strengths,
      ...report.insights.weaknesses,
      ...Object.values(report.skillScores),
    ].join(" ").toLocaleLowerCase();
    return searchable.includes(query);
  });

  return filtered.sort((a, b) => {
    if (filters.sort === "oldest") return a.createdAt - b.createdAt;
    if (filters.sort === "focus-high") return (getReportFocus(b) ?? -1) - (getReportFocus(a) ?? -1);
    if (filters.sort === "focus-low") return (getReportFocus(a) ?? 101) - (getReportFocus(b) ?? 101);
    if (filters.sort === "problem") return a.problemTitle.localeCompare(b.problemTitle);
    if (filters.sort === "language") return a.language.localeCompare(b.language);
    return b.createdAt - a.createdAt;
  });
};

export const focusStatus = (focus: number | null) => {
  if (focus === null) return "No score";
  if (focus >= 80) return "Strong";
  if (focus >= 50) return "Developing";
  return "Building";
};
