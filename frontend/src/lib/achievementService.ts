export type AchievementCategory = "Coding" | "Learning" | "Assignments" | "Consistency";

export type AchievementActivity = {
  kind: "run" | "problem" | "assignment" | "feedback" | "assessment";
  at: number;
  language?: string;
  entityId?: string;
};

export type AchievementMetrics = {
  isTeacher?: boolean;
  problemsSolved: number;
  codeRuns: number;
  assignmentsCompleted: number;
  pythonRuns: number;
  longestStreak: number;
  learningDays: number;
  feedbackReceived: number;
  activities: AchievementActivity[];
};

export type Achievement = {
  key: string;
  name: string;
  description: string;
  category: AchievementCategory;
  icon: "code" | "check" | "assignment" | "python" | "streak" | "learning" | "feedback";
  progress: number;
  target: number;
  earned: boolean;
  earnedAt: number | null;
};

const firstMatchingActivity = (activities: AchievementActivity[], predicate: (activity: AchievementActivity) => boolean) =>
  activities.filter(predicate).sort((a, b) => a.at - b.at)[0]?.at ?? null;

const activityAtCount = (
  activities: AchievementActivity[],
  predicate: (activity: AchievementActivity) => boolean,
  target: number,
) => {
  const matching = activities.filter(predicate).sort((a, b) => a.at - b.at);
  return matching.length >= target ? matching[target - 1].at : null;
};

const uniqueAssignmentAtCount = (activities: AchievementActivity[], target: number) => {
  const firstByAssignment = new Map<string, number>();
  for (const activity of activities) {
    if (activity.kind !== "assignment") continue;
    const key = activity.entityId || String(activity.at);
    const first = firstByAssignment.get(key);
    if (first === undefined || activity.at < first) firstByAssignment.set(key, activity.at);
  }
  const completedAt = [...firstByAssignment.values()].sort((a, b) => a - b);
  return completedAt.length >= target ? completedAt[target - 1] : null;
};

const dateKey = (timestamp: number) => {
  const date = new Date(timestamp);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
};

const streakAchievedAt = (activities: AchievementActivity[], target: number) => {
  const firstByDay = new Map<string, number>();
  for (const activity of activities) {
    const key = dateKey(activity.at);
    const first = firstByDay.get(key);
    if (first === undefined || activity.at < first) firstByDay.set(key, activity.at);
  }
  const days = [...firstByDay.entries()].sort(([a], [b]) => a.localeCompare(b));
  let streak = 0;
  let previousDay: Date | null = null;
  for (const [key, at] of days) {
    const [year, month, day] = key.split("-").map(Number);
    const currentDay = new Date(year, month, day);
    const difference = previousDay
      ? Math.round((currentDay.getTime() - previousDay.getTime()) / 86_400_000)
      : null;
    streak = difference === 1 ? streak + 1 : 1;
    if (streak >= target) return at;
    previousDay = currentDay;
  }
  return null;
};

const learningDaysAtCount = (activities: AchievementActivity[], target: number) => {
  const days = [...new Map(
    activities.map((activity) => [dateKey(activity.at), activity.at] as const),
  ).entries()].sort(([a], [b]) => a.localeCompare(b));
  return days.length >= target ? days[target - 1][1] : null;
};

export const calculateAchievements = (metrics: AchievementMetrics): Achievement[] => {
  const definitions: Array<Omit<Achievement, "progress" | "earned" | "earnedAt"> & {
    value: number;
    earnedAt: number | null;
  }> = [
    {
      key: "first-code-run",
      name: "First Code Run",
      description: "Run code in a practice or assignment session.",
      category: "Coding",
      icon: "code",
      value: metrics.codeRuns,
      target: 1,
      earnedAt: firstMatchingActivity(metrics.activities, (activity) => activity.kind === "run"),
    },
    {
      key: "first-problem",
      name: "First Problem Solved",
      description: "Pass a recorded coding problem.",
      category: "Learning",
      icon: "check",
      value: metrics.problemsSolved,
      target: 1,
      earnedAt: firstMatchingActivity(metrics.activities, (activity) => activity.kind === "problem"),
    },
    {
      key: "first-assignment",
      name: metrics.isTeacher ? "First Assignment Room" : "First Assignment",
      description: metrics.isTeacher ? "Create a teacher assignment room." : "Submit work for a teacher assignment.",
      category: "Assignments",
      icon: "assignment",
      value: metrics.assignmentsCompleted,
      target: 1,
      earnedAt: firstMatchingActivity(metrics.activities, (activity) => activity.kind === "assignment"),
    },
    {
      key: "python-practice",
      name: "Python Practice",
      description: "Run Python code 10 times.",
      category: "Coding",
      icon: "python",
      value: metrics.pythonRuns,
      target: 10,
      earnedAt: activityAtCount(metrics.activities, (activity) => activity.kind === "run" && activity.language?.toLowerCase() === "python", 10),
    },
    {
      key: "seven-day-streak",
      name: "7 Day Streak",
      description: "Learn on seven consecutive days.",
      category: "Consistency",
      icon: "streak",
      value: metrics.longestStreak,
      target: 7,
      earnedAt: streakAchievedAt(metrics.activities, 7),
    },
    {
      key: "thirty-day-streak",
      name: "30 Day Streak",
      description: "Learn on 30 consecutive days.",
      category: "Consistency",
      icon: "streak",
      value: metrics.longestStreak,
      target: 30,
      earnedAt: streakAchievedAt(metrics.activities, 30),
    },
    {
      key: "ten-problems",
      name: "10 Problems Solved",
      description: "Pass 10 recorded coding problems.",
      category: "Learning",
      icon: "check",
      value: metrics.problemsSolved,
      target: 10,
      earnedAt: activityAtCount(metrics.activities, (activity) => activity.kind === "problem", 10),
    },
    {
      key: "fifty-problems",
      name: "50 Problems Solved",
      description: "Pass 50 recorded coding problems.",
      category: "Learning",
      icon: "check",
      value: metrics.problemsSolved,
      target: 50,
      earnedAt: activityAtCount(metrics.activities, (activity) => activity.kind === "problem", 50),
    },
    {
      key: "hundred-runs",
      name: "100 Code Runs",
      description: "Run code 100 times.",
      category: "Coding",
      icon: "code",
      value: metrics.codeRuns,
      target: 100,
      earnedAt: activityAtCount(metrics.activities, (activity) => activity.kind === "run", 100),
    },
    {
      key: "teacher-feedback",
      name: metrics.isTeacher ? "First Feedback Given" : "First Teacher Feedback",
      description: metrics.isTeacher ? "Give private feedback to a student." : "Receive private feedback from a teacher.",
      category: "Assignments",
      icon: "feedback",
      value: metrics.feedbackReceived,
      target: 1,
      earnedAt: firstMatchingActivity(metrics.activities, (activity) => activity.kind === "feedback"),
    },
    {
      key: "ten-learning-days",
      name: "10 Learning Days",
      description: "Record activity on 10 different days.",
      category: "Consistency",
      icon: "learning",
      value: metrics.learningDays,
      target: 10,
      earnedAt: learningDaysAtCount(metrics.activities, 10),
    },
    {
      key: "five-assignments",
      name: metrics.isTeacher ? "5 Assignment Rooms" : "5 Assignments",
      description: metrics.isTeacher ? "Create five teacher assignment rooms." : "Submit work for five different teacher assignments.",
      category: "Assignments",
      icon: "assignment",
      value: metrics.assignmentsCompleted,
      target: 5,
      earnedAt: uniqueAssignmentAtCount(metrics.activities, 5),
    },
  ];

  return definitions.map(({ value, ...definition }) => ({
    ...definition,
    progress: Math.min(value, definition.target),
    earned: value >= definition.target,
  }));
};
