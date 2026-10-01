import { describe, expect, it } from "vitest";
import { calculateAchievements, type AchievementActivity, type AchievementMetrics } from "@/lib/achievementService";

const emptyMetrics: AchievementMetrics = {
  problemsSolved: 0,
  codeRuns: 0,
  assignmentsCompleted: 0,
  pythonRuns: 0,
  longestStreak: 0,
  learningDays: 0,
  feedbackReceived: 0,
  activities: [],
};

describe("achievement calculations", () => {
  it("does not award milestones without supporting activity", () => {
    const achievements = calculateAchievements(emptyMetrics);
    expect(achievements).toHaveLength(12);
    expect(achievements.every((achievement) => !achievement.earned && achievement.progress === 0 && achievement.earnedAt === null)).toBe(true);
  });

  it("awards milestones at real thresholds and records the milestone date", () => {
    const start = new Date(2026, 0, 1, 12).getTime();
    const activities: AchievementActivity[] = [];
    for (let day = 0; day < 10; day += 1) {
      const at = start + day * 86_400_000;
      activities.push({ kind: "run", language: "python", at });
      if (day === 0) activities.push({ kind: "problem", at });
      if (day === 1) activities.push({ kind: "feedback", at });
      if (day < 5) activities.push({ kind: "assignment", entityId: `room-${day}`, at });
    }
    const achievements = calculateAchievements({
      problemsSolved: 10,
      codeRuns: 100,
      assignmentsCompleted: 5,
      pythonRuns: 10,
      longestStreak: 10,
      learningDays: 10,
      feedbackReceived: 1,
      activities: [
        ...activities,
        ...Array.from({ length: 90 }, (_, index) => ({
          kind: "run" as const,
          language: "javascript",
          at: start + (index + 10) * 60_000,
        })),
      ],
    });
    const byKey = new Map(achievements.map((achievement) => [achievement.key, achievement]));

    expect(byKey.get("python-practice")?.earned).toBe(true);
    expect(byKey.get("ten-problems")?.earned).toBe(true);
    expect(byKey.get("hundred-runs")?.earned).toBe(true);
    expect(byKey.get("five-assignments")?.earnedAt).toBe(start + 4 * 86_400_000);
    expect(byKey.get("seven-day-streak")?.earnedAt).toBe(start + 6 * 86_400_000);
    expect(byKey.get("ten-learning-days")?.earned).toBe(true);
  });

  it("counts assignment achievements by distinct assignment rather than submission attempts", () => {
    const activities: AchievementActivity[] = Array.from({ length: 5 }, (_, index) => ({
      kind: "assignment",
      entityId: "one-room",
      at: index + 1,
    }));
    const achievement = calculateAchievements({
      ...emptyMetrics,
      assignmentsCompleted: 1,
      activities,
    }).find((item) => item.key === "five-assignments");

    expect(achievement?.earned).toBe(false);
    expect(achievement?.earnedAt).toBeNull();
  });
});
