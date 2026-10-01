import { describe, expect, it } from "vitest";
import type { AssessmentReport } from "@/hooks/useAssessmentSession";
import { filterAndSortReports, focusStatus, getReportFocus, getReportLanguage, getReportMetrics } from "@/lib/reportDashboardUtils";

type ReportFixture = Pick<AssessmentReport, "id" | "createdAt" | "language" | "problemTitle"> & { focus: number };

const report = (overrides: ReportFixture): AssessmentReport => ({
  id: overrides.id,
  testId: `test-${overrides.id}`,
  createdAt: overrides.createdAt,
  language: overrides.language,
  difficulty: "medium",
  problemTitle: overrides.problemTitle,
  skillScores: {
    problemSolving: 0,
    debugging: 0,
    focus: overrides.focus,
    planning: 0,
    adaptability: 0,
  },
  heatmap: [],
  behaviorTimeline: [],
  insights: { strengths: [], weaknesses: [], summary: "" },
});

const fixtures = [
  report({ id: "r0", createdAt: new Date(2026, 7, 31).getTime(), language: "java", problemTitle: "Old Report", focus: 74 }),
  report({ id: "r1", createdAt: new Date(2026, 8, 28).getTime(), language: "python", problemTitle: "Balanced Brackets", focus: 82 }),
  report({ id: "r2", createdAt: new Date(2026, 8, 30).getTime(), language: "javascript", problemTitle: "Array Search", focus: 66 }),
  report({ id: "r3", createdAt: new Date(2026, 9, 1).getTime(), language: "python", problemTitle: "Tree Traversal", focus: 42 }),
];

describe("report dashboard metrics and filters", () => {
  it("calculates summary metrics from saved reports", () => {
    expect(getReportMetrics(fixtures)).toEqual({
      totalReports: 4,
      averageFocus: 66,
      languageCount: 3,
      latestReport: fixtures[3],
    });
    expect(getReportMetrics([]).averageFocus).toBeNull();
    expect(getReportFocus(fixtures[1])).toBe(82);
  });

  it("filters by query, language, date, and focus, then sorts", () => {
    expect(filterAndSortReports(fixtures, {
      query: "array",
      language: "all",
      date: "all",
      focus: "all",
      sort: "newest",
    }).map((item) => item.id)).toEqual(["r2"]);
    expect(filterAndSortReports(fixtures, {
      query: "",
      language: "python",
      date: "all",
      focus: "all",
      sort: "focus-high",
    }).map((item) => item.id)).toEqual(["r1", "r3"]);
    expect(filterAndSortReports(fixtures, {
      query: "",
      language: "all",
      date: "all",
      focus: "medium",
      sort: "oldest",
    }).map((item) => item.id)).toEqual(["r0", "r2"]);
    expect(filterAndSortReports(fixtures, {
      query: "",
      language: "all",
      date: "30days",
      focus: "all",
      sort: "newest",
      now: new Date(2026, 9, 1, 12).getTime(),
    }).map((item) => item.id)).toEqual(["r3", "r2", "r1"]);
  });

  it("labels focus without inventing a score", () => {
    expect(focusStatus(91)).toBe("Strong");
    expect(focusStatus(55)).toBe("Developing");
    expect(focusStatus(22)).toBe("Building");
    expect(focusStatus(null)).toBe("No score");
  });

  it("omits missing language and focus values from analytics", () => {
    const incomplete = {
      ...fixtures[0],
      languageAvailable: false,
      focusScoreAvailable: false,
    };
    expect(getReportLanguage(incomplete)).toBe("");
    expect(getReportFocus(incomplete)).toBeNull();
    expect(getReportMetrics([incomplete])).toMatchObject({ languageCount: 0, averageFocus: null });
  });
});
