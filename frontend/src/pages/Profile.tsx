import Navbar from "@/components/Navbar";
import UserAvatar from "@/components/UserAvatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useNavigate } from "react-router-dom";
import { useSupabaseAuth } from "@/hooks/useSupabaseAuth";
import { getSupabaseClient, hasSupabaseEnv } from "@/lib/supabase";
import { dateKey, getProfileAvatarExtension, getStreakStats, normalizeProfileUrl, validateProfileAvatarFile } from "@/lib/profileUtils";
import { calculateAchievements, type Achievement } from "@/lib/achievementService";
import { toast } from "@/components/ui/sonner";
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Award, BookOpen, Check, CheckCircle2, CircleHelp, Code2, ExternalLink, Flame, Github, GraduationCap, Linkedin, Loader2, LockKeyhole, MapPin, Pencil, Save, Target, X } from "lucide-react";

type ProfilePrefs = {
  name: string;
  headline: string;
  location: string;
  about: string;
  preferredLanguage: string;
  difficultyBias: string;
  github: string;
  linkedin: string;
};

type ActivityItem = {
  id: string;
  title: string;
  at: number;
  kind: "assessment" | "run" | "problem" | "assignment" | "feedback";
  language?: string;
  entityId?: string;
};

type ActivityCell = {
  key: string;
  date: Date;
  count: number;
  level: number;
};

type AssignmentStats = {
  assignments: number;
  students: number;
  completed: number;
  inProgress: number;
  pending: number;
  totalParticipants: number;
  feedbackGiven: number;
};

type ActivityPeriod = 7 | 30 | 90;
type AchievementFilter = "all" | "earned" | "locked";

const defaultPrefs: ProfilePrefs = {
  name: "",
  headline: "",
  location: "",
  about: "",
  preferredLanguage: "python",
  difficultyBias: "Balanced",
  github: "",
  linkedin: "",
};

const languages = ["python", "javascript", "java", "cpp", "c", "go", "rust"];
const difficulties = ["Balanced", "Hard-first", "Medium-focused", "Easy warmups"];
const API_BASE = import.meta.env.VITE_COLLABORATION_API_URL
  || import.meta.env.VITE_CODE_RUNNER_URL
  || (import.meta.env.DEV ? "http://localhost:3001" : "https://mindcode-4v9p.onrender.com");

const makeHeatmap = (activity: Record<string, number>, today = new Date()) => {
  const end = new Date(today);
  end.setHours(0, 0, 0, 0);
  const start = new Date(end);
  start.setDate(start.getDate() - 364);
  const cells: (ActivityCell | null)[] = Array(start.getDay()).fill(null);

  for (let date = new Date(start); date <= end; date.setDate(date.getDate() + 1)) {
    const cellDate = new Date(date);
    const count = activity[dateKey(cellDate)] || 0;
    cells.push({ key: dateKey(cellDate), date: cellDate, count, level: count === 0 ? 0 : Math.min(4, count) });
  }

  const weeks: (ActivityCell | null)[][] = [];
  for (let index = 0; index < cells.length; index += 7) weeks.push(cells.slice(index, index + 7));
  return weeks;
};

const relativeTime = (timestamp: number) => {
  const elapsed = Math.max(0, Date.now() - timestamp);
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days} days ago`;
  return new Date(timestamp).toLocaleDateString();
};

const formatActivityDate = (date: Date) => date.toLocaleDateString(undefined, {
  day: "2-digit",
  month: "long",
  year: "numeric",
});

const Profile = () => {
  const navigate = useNavigate();
  const { user, userRole } = useSupabaseAuth();
  const [profile, setProfile] = useState<ProfilePrefs>(defaultPrefs);
  const [draft, setDraft] = useState<ProfilePrefs>(defaultPrefs);
  const [photo, setPhoto] = useState("");
  const [draftPhoto, setDraftPhoto] = useState("");
  const [avatarPath, setAvatarPath] = useState<string | null>(null);
  const [draftAvatarPath, setDraftAvatarPath] = useState<string | null>(null);
  const [legacyPhotoData, setLegacyPhotoData] = useState<string | null>(null);
  const [avatarStorageReady, setAvatarStorageReady] = useState(false);
  const [pendingAvatarFile, setPendingAvatarFile] = useState<File | null>(null);
  const [avatarChanged, setAvatarChanged] = useState(false);
  const [removePhotoOpen, setRemovePhotoOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [profileLoadFailed, setProfileLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [activityItems, setActivityItems] = useState<ActivityItem[]>([]);
  const [problemsSolved, setProblemsSolved] = useState(0);
  const [assignmentStats, setAssignmentStats] = useState<AssignmentStats | null>(null);
  const [activityPeriod, setActivityPeriod] = useState<ActivityPeriod>(30);
  const [achievementFilter, setAchievementFilter] = useState<AchievementFilter>("all");
  const [selectedAchievement, setSelectedAchievement] = useState<Achievement | null>(null);
  const [activityLoading, setActivityLoading] = useState(true);
  const [activityLoadError, setActivityLoadError] = useState(false);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const fileRef = useRef<HTMLInputElement | null>(null);
  const previewUrlRef = useRef<string | null>(null);

  const loadProfile = useCallback(async () => {
    if (!user) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setProfileLoadFailed(false);
    try {
      const client = getSupabaseClient();
      let { data, error } = await client.from("users")
        .select("name,email,headline,location,about,preferred_language,difficulty_bias,github_url,linkedin_url,avatar_path,photo_data")
        .eq("id", user.id)
        .maybeSingle();
      if (error && (error.code === "42703" || error.code === "PGRST204" || /avatar_path.*(?:does not exist|could not find)/i.test(error.message))) {
        const legacyProfile = await client.from("users")
          .select("name,email,headline,location,about,preferred_language,difficulty_bias,github_url,linkedin_url,photo_data")
          .eq("id", user.id)
          .maybeSingle();
        if (legacyProfile.error) throw legacyProfile.error;
        data = { ...legacyProfile.data, avatar_path: null };
        error = null;
        setAvatarStorageReady(false);
        toast.info("Apply the profile avatar migration to enable secure photo uploads.");
      } else if (!error) {
        setAvatarStorageReady(true);
      }
      if (error) throw error;
      const next: ProfilePrefs = {
        ...defaultPrefs,
        name: data?.name || (typeof user.user_metadata?.name === "string" ? user.user_metadata.name : ""),
        headline: data?.headline || "",
        location: data?.location || "",
        about: data?.about || "",
        preferredLanguage: data?.preferred_language || "python",
        difficultyBias: data?.difficulty_bias || "Balanced",
        github: data?.github_url || "",
        linkedin: data?.linkedin_url || "",
      };
      setProfile(next);
      setDraft(next);
      setAvatarPath(data?.avatar_path || null);
      setDraftAvatarPath(data?.avatar_path || null);
      setLegacyPhotoData(data?.photo_data || null);
      let imageSource = data?.photo_data || "";
      if (data?.avatar_path) {
        const { data: signedImage, error: signedImageError } = await client.storage
          .from("avatars")
          .createSignedUrl(data.avatar_path, 3600);
        if (signedImageError) {
          console.error("[Profile] Unable to load avatar from storage:", signedImageError);
          setAvatarStorageReady(false);
          toast.error("Unable to display your profile photo. Check the avatar storage setup.");
        } else {
          imageSource = signedImage.signedUrl;
        }
      }
      setPhoto(imageSource);
      setDraftPhoto(imageSource);
    } catch (error) {
      console.error("[Profile] Unable to load profile:", error);
      setProfileLoadFailed(true);
      toast.error("Unable to load your profile.");
    } finally {
      setLoading(false);
    }
  }, [user]);

  const loadLearningData = useCallback(async () => {
    if (!user) {
      setActivityLoading(false);
      return;
    }
    setActivityLoading(true);
    setActivityItems([]);
    setProblemsSolved(0);
    setAssignmentStats(null);
    setActivityLoadError(false);
    const client = getSupabaseClient();
    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - 364);
    const since = fromDate.toISOString();
    const events: ActivityItem[] = [];
    let assignmentDataAvailable = true;
    const unavailableAssignmentMetrics = () => {
      assignmentDataAvailable = false;
    };

    try {
      const [{ data: reports, error: reportError }, { data: runs, error: runError }] = await Promise.all([
        client.from("reports").select("id,test_id,created_at,skill_tests(question,language)")
          .eq("user_id", user.id).gte("created_at", since).order("created_at", { ascending: false }).limit(1000),
        client.from("submissions").select("id,test_id,language,passed,created_at")
          .eq("user_id", user.id).gte("created_at", since).order("created_at", { ascending: false }).limit(1000),
      ]);
      if (reportError) throw reportError;
      if (runError) throw runError;
      const testTitles = new Map<string, string>();
      for (const report of reports || []) {
        const title = typeof report.skill_tests?.question === "string"
          ? report.skill_tests.question.trim().slice(0, 90)
          : "";
        if (report.test_id && title) testTitles.set(report.test_id, title);
        const at = Date.parse(report.created_at);
        if (Number.isFinite(at)) {
          events.push({ id: `report-${report.id}`, title: `Completed ${title || "an assessment"}`, at, kind: "assessment" });
        }
      }
      for (const run of runs || []) {
        const at = Date.parse(run.created_at);
        if (!Number.isFinite(at)) continue;
        events.push({
          id: `run-${run.id}`,
          title: run.test_id && testTitles.has(run.test_id)
            ? `Ran code for ${testTitles.get(run.test_id)}`
            : `Ran ${run.language || "code"} code`,
          at,
          kind: "run",
          language: run.language || undefined,
        });
      }
      const solvedAt = new Map<string, number>();
      for (const run of [...(runs || [])].filter((item) => item.passed === true && item.test_id).sort((a, b) =>
        Date.parse(a.created_at) - Date.parse(b.created_at))) {
        if (!run.test_id || solvedAt.has(run.test_id)) continue;
        const at = Date.parse(run.created_at);
        if (Number.isFinite(at)) solvedAt.set(run.test_id, at);
      }
      setProblemsSolved(solvedAt.size);
      for (const [testId, at] of solvedAt) {
        events.push({
          id: `problem-${testId}`,
          title: `Solved ${testTitles.get(testId) || "a coding problem"}`,
          at,
          kind: "problem",
        });
      }

      if (userRole === "student") {
        const [assignmentSubmissions, assignmentRuns, feedback, memberships] = await Promise.all([
          client.from("collaboration_assignment_submissions")
            .select("id,room_id,submitted_at").eq("user_id", user.id)
            .gte("submitted_at", since).order("submitted_at", { ascending: false }).limit(1000),
          client.from("collaboration_assignment_runs")
            .select("id,room_id,ran_at").eq("user_id", user.id)
            .gte("ran_at", since).order("ran_at", { ascending: false }).limit(1000),
          client.from("collaboration_assignment_feedback")
            .select("id,room_id,created_at").eq("user_id", user.id)
            .gte("created_at", since).order("created_at", { ascending: false }).limit(1000),
          client.from("collaboration_room_members").select("room_id").eq("user_id", user.id),
        ]);
        if (assignmentSubmissions.error || assignmentRuns.error || feedback.error || memberships.error) {
          unavailableAssignmentMetrics();
          console.warn("[Profile] Assignment activity is unavailable; apply the assignment database migration.", {
            submissions: assignmentSubmissions.error?.code,
            runs: assignmentRuns.error?.code,
            feedback: feedback.error?.code,
            memberships: memberships.error?.code,
          });
        } else {
          const candidateRoomIds = [...new Set([
            ...(memberships.data || []).map((row) => row.room_id),
            ...(assignmentSubmissions.data || []).map((row) => row.room_id),
            ...(assignmentRuns.data || []).map((row) => row.room_id),
            ...(feedback.data || []).map((row) => row.room_id),
          ])];
          const { data: roomRecords, error: roomsError } = candidateRoomIds.length
            ? await client.from("collaboration_rooms").select("id,room_type,teacher_id,language").in("id", candidateRoomIds)
            : { data: [], error: null };
          if (roomsError) unavailableAssignmentMetrics();
          else {
            const assignmentRoomRecords = (roomRecords || []).filter((room) =>
              room.room_type === "teacher_assignment" && Boolean(room.teacher_id));
            const roomIds = assignmentRoomRecords.map((room) => room.id);
            const [{ data: assignments, error: assignmentsError }, { data: progress, error: progressError }] = roomIds.length
              ? await Promise.all([
                  client.from("collaboration_assignments").select("room_id,title").in("room_id", roomIds),
                  client.from("collaboration_assignment_progress").select("room_id,submission_status,code_runs,attempts").eq("user_id", user.id).in("room_id", roomIds),
                ])
              : [{ data: [], error: null }, { data: [], error: null }];
            if (assignmentsError || progressError) unavailableAssignmentMetrics();
            const titleByRoom = new Map((assignments || []).map((item) => [item.room_id, item.title]));
            const languageByRoom = new Map(assignmentRoomRecords.map((room) => [room.id, room.language]));
            for (const submission of assignmentSubmissions.data || []) {
              if (!roomIds.includes(submission.room_id)) continue;
              const at = Date.parse(submission.submitted_at);
              if (Number.isFinite(at)) {
                events.push({
                  id: `assignment-${submission.id}`,
                  entityId: submission.room_id,
                  title: `Submitted ${titleByRoom.get(submission.room_id) || "an assignment"}`,
                  at,
                  kind: "assignment",
                });
              }
            }
            for (const run of assignmentRuns.data || []) {
              if (!roomIds.includes(run.room_id)) continue;
              const at = Date.parse(run.ran_at);
              if (Number.isFinite(at)) events.push({
                id: `assignment-run-${run.id}`,
                title: "Ran code in an assignment",
                at,
                kind: "run",
                language: languageByRoom.get(run.room_id) || undefined,
              });
            }
            for (const item of feedback.data || []) {
              if (!roomIds.includes(item.room_id)) continue;
              const at = Date.parse(item.created_at);
              if (Number.isFinite(at)) events.push({ id: `feedback-${item.id}`, title: "Received teacher feedback", at, kind: "feedback" });
            }
            if (!assignmentsError && !progressError) {
              const progressByRoom = new Map((progress || []).map((row) => [row.room_id, row]));
              const completed = roomIds.filter((roomId) => progressByRoom.get(roomId)?.submission_status === "Submitted").length;
              const inProgress = roomIds.filter((roomId) => {
                const item = progressByRoom.get(roomId);
                return item && item.submission_status !== "Submitted" && (item.code_runs > 0 || item.attempts > 0);
              }).length;
              setAssignmentStats({
                assignments: roomIds.length,
                students: 0,
                completed,
                inProgress,
                pending: roomIds.length - completed - inProgress,
                totalParticipants: roomIds.length,
                feedbackGiven: 0,
              });
            }
          }
        }
      } else if (userRole === "teacher") {
        const { data: sessionData, error: sessionError } = await client.auth.getSession();
        if (sessionError) throw sessionError;
        const token = sessionData.session?.access_token;
        if (!token) throw new Error("Your sign-in session has expired.");
        const response = await fetch(`${API_BASE}/api/collaboration/assignments`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || "Unable to load teaching activity.");
        const rooms = body.assignments || [];
        const monitoring = await Promise.all(rooms.map(async (room: { id: string; assignment?: { title?: string }; createdAt?: string }) => {
          const monitoringResponse = await fetch(`${API_BASE}/api/collaboration/assignments/${encodeURIComponent(room.id)}/monitoring`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          const monitoringBody = await monitoringResponse.json().catch(() => ({}));
          if (!monitoringResponse.ok) throw new Error(monitoringBody.error || "Unable to load teaching activity.");
          return { room, students: monitoringBody.students || [] };
        }));
        const students = new Set<string>();
        let completed = 0;
        let inProgress = 0;
        let totalParticipants = 0;
        let feedbackGiven = 0;
        for (const { room, students: roomStudents } of monitoring) {
          if (room.createdAt) {
            const at = Date.parse(room.createdAt);
            if (Number.isFinite(at)) events.push({
              id: `room-${room.id}`,
              entityId: room.id,
              title: `Created ${room.assignment?.title || "an assignment room"}`,
              at,
              kind: "assignment",
            });
          }
          for (const student of roomStudents) {
            students.add(student.userId);
            totalParticipants += 1;
            if (student.progress?.submission_status === "Submitted") completed += 1;
            else if ((student.progress?.code_runs || 0) > 0 || (student.progress?.attempts || 0) > 0) inProgress += 1;
            feedbackGiven += Array.isArray(student.feedback) ? student.feedback.length : 0;
            for (const item of student.feedback || []) {
              const at = Date.parse(item.created_at);
              if (Number.isFinite(at)) events.push({ id: `given-feedback-${item.id}`, title: "Gave assignment feedback", at, kind: "feedback" });
            }
          }
        }
        setAssignmentStats({
          assignments: rooms.length,
          students: students.size,
          completed,
          inProgress,
          pending: totalParticipants - completed - inProgress,
          totalParticipants,
          feedbackGiven,
        });
      }
    } catch (error) {
      console.error("[Profile] Unable to load learning activity:", error);
      setActivityLoadError(true);
      toast.error("Some learning activity could not be loaded.");
    } finally {
      const cutoff = Date.parse(since);
      setActivityItems(events.filter((item) => item.at >= cutoff).sort((a, b) => b.at - a.at));
      setActivityLoading(false);
      if (!assignmentDataAvailable) {
        toast.info("Assignment activity is unavailable until the assignment database migration is applied.");
      }
    }
  }, [user, userRole]);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  useEffect(() => {
    void loadLearningData();
  }, [loadLearningData]);

  useEffect(() => {
    if (!editing) return;
    const hasUnsavedChanges = JSON.stringify(draft) !== JSON.stringify(profile) || avatarChanged;
    if (!hasUnsavedChanges) return;
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [editing, draft, profile, avatarChanged]);

  const activityByDay = useMemo(() => activityItems.reduce<Record<string, number>>((counts, item) => {
    const key = dateKey(new Date(item.at));
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {}), [activityItems]);
  const weeks = useMemo(() => makeHeatmap(activityByDay), [activityByDay]);
  const streaks = useMemo(() => getStreakStats(Object.keys(activityByDay)), [activityByDay]);
  const periodActivity = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return Array.from({ length: activityPeriod }, (_, index) => {
      const date = new Date(today);
      date.setDate(today.getDate() - (activityPeriod - index - 1));
      const key = dateKey(date);
      return {
        date: key,
        label: date.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
        codeRuns: activityItems.filter((item) => item.kind === "run" && dateKey(new Date(item.at)) === key).length,
        problemsSolved: activityItems.filter((item) => item.kind === "problem" && dateKey(new Date(item.at)) === key).length,
      };
    });
  }, [activityItems, activityPeriod]);
  const languageUsage = useMemo(() => {
    const usage = new Map<string, number>();
    for (const item of activityItems) {
      if (item.kind !== "run" || !item.language) continue;
      const language = item.language.trim();
      if (language) usage.set(language, (usage.get(language) || 0) + 1);
    }
    return [...usage.entries()].map(([language, count]) => ({ language, count }))
      .sort((a, b) => b.count - a.count);
  }, [activityItems]);
  const codeRuns = activityItems.filter((item) => item.kind === "run").length;
  const learningAchievements = useMemo(() => calculateAchievements({
    isTeacher: userRole === "teacher",
    problemsSolved,
    codeRuns,
    assignmentsCompleted: new Set(activityItems
      .filter((item) => item.kind === "assignment")
      .map((item) => item.entityId)
      .filter((roomId): roomId is string => Boolean(roomId))).size,
    pythonRuns: activityItems.filter((item) => item.kind === "run" && item.language?.toLowerCase() === "python").length,
    longestStreak: streaks.longest,
    learningDays: streaks.totalDays,
    feedbackReceived: activityItems.filter((item) => item.kind === "feedback").length,
    activities: activityItems,
  }).filter((achievement) => assignmentStats !== null || achievement.category !== "Assignments"),
  [activityItems, assignmentStats, codeRuns, problemsSolved, streaks.longest, streaks.totalDays, userRole]);
  const filteredAchievements = learningAchievements.filter((achievement) =>
    achievementFilter === "all" || (achievementFilter === "earned" ? achievement.earned : !achievement.earned));
  const recentActivity = activityItems.slice(0, 8);
  const selectedDayEvents = selectedDay
    ? activityItems.filter((item) => dateKey(new Date(item.at)) === selectedDay)
    : [];
  const selectedDayBreakdown = selectedDayEvents.reduce<Record<string, number>>((counts, item) => {
    counts[item.kind] = (counts[item.kind] || 0) + 1;
    return counts;
  }, {});
  const isTeacher = userRole === "teacher";
  const githubLink = normalizeProfileUrl(profile.github, "github.com");
  const linkedinLink = normalizeProfileUrl(profile.linkedin, "linkedin.com");
  const username = typeof user?.user_metadata?.username === "string" ? user.user_metadata.username : "";
  const completionItems = [
    { label: "Name", done: Boolean(profile.name.trim()) },
    { label: "Email", done: Boolean(user?.email) },
    { label: "Preferred language", done: Boolean(profile.preferredLanguage) },
    { label: "About", done: Boolean(profile.about.trim()) },
    { label: "Profile photo", done: Boolean(photo) },
    { label: "GitHub", done: Boolean(githubLink) },
    { label: "LinkedIn", done: Boolean(linkedinLink) },
  ];
  const completion = Math.round(completionItems.filter((item) => item.done).length / completionItems.length * 100);

  const updateDraft = (field: keyof ProfilePrefs, value: string) => {
    setDraft((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: "" }));
  };

  const startEditing = () => {
    setDraft(profile);
    setDraftPhoto(photo);
    setDraftAvatarPath(avatarPath);
    setPendingAvatarFile(null);
    setAvatarChanged(false);
    setErrors({});
    setEditing(true);
  };

  const cancelEditing = () => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = null;
    setDraft(profile);
    setDraftPhoto(photo);
    setDraftAvatarPath(avatarPath);
    setPendingAvatarFile(null);
    setAvatarChanged(false);
    setErrors({});
    setEditing(false);
  };

  useEffect(() => () => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
  }, []);

  const validateProfile = () => {
    const nextErrors: Record<string, string> = {};
    if (!draft.name.trim()) nextErrors.name = "Enter your name.";
    else if (draft.name.trim().length > 120) nextErrors.name = "Name must be 120 characters or fewer.";
    if (draft.headline.length > 160) nextErrors.headline = "Headline must be 160 characters or fewer.";
    if (draft.location.length > 120) nextErrors.location = "Location must be 120 characters or fewer.";
    if (draft.about.length > 2000) nextErrors.about = "About must be 2,000 characters or fewer.";
    if (!languages.includes(draft.preferredLanguage)) nextErrors.preferredLanguage = "Choose a supported language.";
    if (!difficulties.includes(draft.difficultyBias)) nextErrors.difficultyBias = "Choose a valid practice preference.";
    if (draft.github && !normalizeProfileUrl(draft.github, "github.com")) nextErrors.github = "Enter a valid GitHub URL.";
    if (draft.linkedin && !normalizeProfileUrl(draft.linkedin, "linkedin.com")) nextErrors.linkedin = "Enter a valid LinkedIn URL.";
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const saveProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!user || profileLoadFailed || !validateProfile()) return;
    if (avatarChanged && !avatarStorageReady && pendingAvatarFile) {
      toast.error("Apply the profile avatar migration before uploading a photo.");
      return;
    }
    setSaving(true);
    let uploadedAvatarPath: string | null = null;
    try {
      const client = getSupabaseClient();
      if (pendingAvatarFile) {
        const fileValidationError = validateProfileAvatarFile(pendingAvatarFile.type, pendingAvatarFile.size);
        if (fileValidationError) throw new Error(fileValidationError);
        const extension = getProfileAvatarExtension(pendingAvatarFile.type);
        if (!extension) throw new Error("Please upload a JPG, PNG, or WEBP image smaller than 5 MB.");
        const newAvatarPath = `${user.id}/${crypto.randomUUID()}.${extension}`;
        const { error: uploadError } = await client.storage.from("avatars").upload(newAvatarPath, pendingAvatarFile, {
          cacheControl: "3600",
          contentType: pendingAvatarFile.type,
          upsert: false,
        });
        if (uploadError) throw uploadError;
        uploadedAvatarPath = newAvatarPath;
      }
      const nextAvatarPath = pendingAvatarFile ? uploadedAvatarPath : draftAvatarPath;
      const { error } = await client.from("users").upsert({
        id: user.id,
        name: draft.name.trim(),
        email: user.email || "",
        headline: draft.headline.trim(),
        location: draft.location.trim(),
        about: draft.about.trim(),
        preferred_language: draft.preferredLanguage,
        difficulty_bias: draft.difficultyBias,
        github_url: normalizeProfileUrl(draft.github, "github.com"),
        linkedin_url: normalizeProfileUrl(draft.linkedin, "linkedin.com"),
        ...(avatarStorageReady ? { avatar_path: nextAvatarPath } : {}),
        photo_data: avatarChanged ? null : legacyPhotoData,
      }, { onConflict: "id" });
      if (error) throw error;
      const oldAvatarPath = avatarPath;
      if (avatarChanged && oldAvatarPath && oldAvatarPath !== nextAvatarPath) {
        const { error: removeError } = await client.storage.from("avatars").remove([oldAvatarPath]);
        if (removeError) {
          console.error("[Profile] Unable to delete replaced avatar:", removeError);
          toast.error("Profile saved, but the previous photo could not be removed from storage.");
        }
      }
      let savedPhoto = avatarChanged ? "" : photo;
      if (nextAvatarPath) {
        const { data: signedImage, error: signedImageError } = await client.storage.from("avatars")
          .createSignedUrl(nextAvatarPath, 3600);
        if (signedImageError) {
          console.error("[Profile] Unable to create avatar preview URL:", signedImageError);
          toast.error("Profile saved, but the new photo could not be displayed.");
        } else {
          savedPhoto = signedImage.signedUrl;
        }
      }
      const saved = {
        ...draft,
        name: draft.name.trim(),
        headline: draft.headline.trim(),
        location: draft.location.trim(),
        about: draft.about.trim(),
        github: normalizeProfileUrl(draft.github, "github.com") || "",
        linkedin: normalizeProfileUrl(draft.linkedin, "linkedin.com") || "",
      };
      setProfile(saved);
      setDraft(saved);
      setAvatarPath(nextAvatarPath);
      setDraftAvatarPath(nextAvatarPath);
      setLegacyPhotoData(avatarChanged ? null : legacyPhotoData);
      setPhoto(savedPhoto);
      setDraftPhoto(savedPhoto);
      setPendingAvatarFile(null);
      setAvatarChanged(false);
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
      setEditing(false);
      toast.success("Profile updated successfully.");
    } catch (error) {
      console.error("[Profile] Unable to save profile:", error);
      if (uploadedAvatarPath) {
        try {
          const { error: cleanupError } = await getSupabaseClient().storage.from("avatars").remove([uploadedAvatarPath]);
          if (cleanupError) console.error("[Profile] Unable to clean up uncommitted avatar:", cleanupError);
        } catch (cleanupError) {
          console.error("[Profile] Unable to clean up uncommitted avatar:", cleanupError);
        }
      }
      toast.error("Unable to save profile. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const onFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const fileValidationError = validateProfileAvatarFile(file.type, file.size);
    if (fileValidationError) {
      toast.error(fileValidationError);
      return;
    }
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    const preview = URL.createObjectURL(file);
    previewUrlRef.current = preview;
    setPendingAvatarFile(file);
    setDraftAvatarPath(null);
    setDraftPhoto(preview);
    setAvatarChanged(true);
    toast.info("Photo preview ready. Save your profile to upload it.");
  };

  const cancelPhotoPreview = () => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = null;
    setPendingAvatarFile(null);
    setDraftAvatarPath(avatarPath);
    setDraftPhoto(photo);
    setAvatarChanged(false);
  };

  const confirmPhotoRemoval = () => {
    if (!editing) {
      setDraft(profile);
      setEditing(true);
    }
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = null;
    setPendingAvatarFile(null);
    setDraftAvatarPath(null);
    setDraftPhoto("");
    setAvatarChanged(true);
    setRemovePhotoOpen(false);
    toast.info("Photo removal is ready. Save your profile to confirm it.");
  };

  const choosePhoto = () => {
    if (!editing) {
      setDraft(profile);
      setDraftAvatarPath(avatarPath);
      setDraftPhoto(photo);
      setAvatarChanged(false);
      setEditing(true);
    }
    fileRef.current?.click();
  };

  const onLogout = async () => {
    setLoggingOut(true);
    try {
      const { error } = await getSupabaseClient().auth.signOut();
      if (error) throw error;
      toast.success("You have been logged out.");
      navigate("/login", { replace: true });
    } catch (error) {
      console.error("[Profile] Unable to log out:", error);
      toast.error("Unable to log out right now.");
    } finally {
      setLoggingOut(false);
    }
  };

  const onChangePassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (password.length < 8) {
      toast.error("Use a password with at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      toast.error("The passwords do not match.");
      return;
    }
    setPasswordSaving(true);
    try {
      const { error } = await getSupabaseClient().auth.updateUser({ password });
      if (error) throw error;
      setPassword("");
      setConfirmPassword("");
      setChangingPassword(false);
      toast.success("Password updated successfully.");
    } catch (error) {
      console.error("[Profile] Unable to change password:", error);
      toast.error("Unable to update your password. Please try again.");
    } finally {
      setPasswordSaving(false);
    }
  };

  const editField = (
    label: string,
    field: keyof ProfilePrefs,
    value: string,
    options: { type?: string; placeholder?: string; maxLength?: number } = {},
  ) => (
    <label className="block min-w-0 text-sm" htmlFor={`profile-${field}`}>
      <span className="font-medium text-foreground">{label}</span>
      <Input
        id={`profile-${field}`}
        type={options.type || "text"}
        maxLength={options.maxLength}
        placeholder={options.placeholder}
        value={value}
        onChange={(event) => updateDraft(field, event.target.value)}
        aria-invalid={Boolean(errors[field])}
        aria-describedby={errors[field] ? `profile-${field}-error` : undefined}
        className="mt-2"
      />
      {errors[field] && <span id={`profile-${field}-error`} className="mt-1 block text-xs text-rose">{errors[field]}</span>}
    </label>
  );

  if (!user) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <Navbar />
        <main className="mx-auto max-w-3xl px-4 pb-12 pt-28">
          <section className="rounded-card border border-border bg-bg-surface p-6 text-center">
            <h1 className="text-2xl font-semibold">Sign in to view your profile</h1>
            <Button className="mt-4" onClick={() => window.location.assign("/login")}>Go to sign in</Button>
          </section>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen overflow-x-hidden bg-background text-foreground">
      <Navbar />
      <main className="mx-auto max-w-6xl space-y-6 px-4 pb-12 pt-24 sm:px-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm text-muted-foreground">Your learning identity</p>
            <h1 className="mt-1 text-3xl font-bold">Profile</h1>
          </div>
        </header>
        {profileLoadFailed && <p role="alert" className="rounded-lg border border-rose/30 bg-rose/5 p-3 text-sm text-rose">Your profile could not be loaded, so editing is disabled to protect existing values.</p>}

        <section className="relative overflow-hidden rounded-card border border-border bg-gradient-to-br from-teal/10 via-bg-surface to-indigo-900/20 p-5 sm:p-7" aria-label="Profile header">
          <div className="grid min-w-0 items-center gap-6 lg:grid-cols-[minmax(0,1fr),minmax(280px,0.85fr)]">
            <div className="flex min-w-0 flex-col items-center gap-5 text-center sm:flex-row sm:items-center sm:text-left">
              <button
                type="button"
                onClick={choosePhoto}
                disabled={saving || loading || profileLoadFailed}
                aria-label="Change profile photo"
                className="shrink-0 rounded-full transition-transform hover:scale-[1.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal disabled:cursor-not-allowed"
              >
                <UserAvatar
                  userId={user.id}
                  name={profile.name || user.email || ""}
                  srcOverride={editing ? draftPhoto : photo}
                  className="h-28 w-28 border-2 border-teal/60 text-2xl"
                  imageClassName="rounded-full"
                />
              </button>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center justify-center gap-3 sm:justify-start">
                  <h2 className="break-words text-2xl font-semibold">{profile.name || "Your profile"}</h2>
                  <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${isTeacher ? "border-indigo-400/30 bg-indigo-400/10 text-indigo-200" : "border-teal/30 bg-teal/10 text-teal"}`}>
                    {isTeacher ? <GraduationCap className="h-3.5 w-3.5" /> : <BookOpen className="h-3.5 w-3.5" />}
                    {isTeacher ? "Teacher" : "Student"}
                  </span>
                </div>
                {username ? <p className="mt-1 text-sm text-muted-foreground">@{username}</p> : <p className="mt-1 break-all text-sm text-muted-foreground">{user.email}</p>}
                <p className="mt-2 break-words text-sm text-muted-foreground">{profile.headline || "Add a headline to share what you’re learning."}</p>
                {profile.location && <p className="mt-2 flex items-center justify-center gap-1.5 text-xs text-muted-foreground sm:justify-start"><MapPin className="h-3.5 w-3.5" />{profile.location}</p>}
                <div className="mt-4 flex flex-wrap justify-center gap-2 sm:justify-start">
                  <Button type="button" size="sm" variant="outline" onClick={choosePhoto} disabled={saving || loading || profileLoadFailed}>
                    Change Photo
                  </Button>
                  {!editing && <Button type="button" size="sm" onClick={startEditing} variant="outline" disabled={loading || profileLoadFailed}>
                    <Pencil className="mr-2 h-4 w-4" />Edit Profile
                  </Button>}
                  {avatarChanged && <Button type="button" size="sm" variant="ghost" onClick={cancelPhotoPreview} disabled={saving}>Cancel Photo Change</Button>}
                  {(photo || draftPhoto || avatarPath || legacyPhotoData || pendingAvatarFile) && (
                    <Button type="button" size="sm" variant="ghost" className="text-rose hover:bg-rose/10" onClick={() => setRemovePhotoOpen(true)} disabled={saving || Boolean(avatarPath && !avatarStorageReady)}>
                      Remove Photo
                    </Button>
                  )}
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
                    className="hidden"
                    onChange={onFileChange}
                  />
                </div>
                {!avatarStorageReady && <p className="mt-2 text-xs text-muted-foreground">Apply <span className="font-mono">migrations/20261001_profile_avatars.sql</span> to enable private photo uploads.</p>}
              </div>
            </div>
            <ProfileIntroVideo />
          </div>
        </section>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.7fr),minmax(280px,1fr)]">
          <section className="min-w-0 rounded-card border border-border bg-bg-surface p-5 sm:p-6" aria-labelledby="personal-information-heading">
            <div className="mb-5 flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-teal">Personal information</p>
                <h2 id="personal-information-heading" className="mt-1 text-xl font-semibold">About you</h2>
              </div>
              {loading && <Loader2 className="h-4 w-4 animate-spin text-teal" aria-label="Loading profile" />}
            </div>

            {editing ? (
              <form onSubmit={(event) => void saveProfile(event)} className="space-y-5">
                <div className="grid gap-4 sm:grid-cols-2">
                  {editField("Name", "name", draft.name, { maxLength: 120, placeholder: "Your name" })}
                  <label className="block min-w-0 text-sm">
                    <span className="font-medium text-foreground">Email</span>
                    <Input className="mt-2" value={user.email || ""} readOnly disabled aria-describedby="profile-email-note" />
                    <span id="profile-email-note" className="mt-1 block text-xs text-muted-foreground">Managed by your sign-in provider.</span>
                  </label>
                  {editField("Headline", "headline", draft.headline, { maxLength: 160, placeholder: "Learning Python · Building projects" })}
                  {editField("Location", "location", draft.location, { maxLength: 120, placeholder: "City, country" })}
                </div>
                <label className="block text-sm" htmlFor="profile-about">
                  <span className="font-medium text-foreground">About</span>
                  <textarea id="profile-about" rows={4} maxLength={2000} value={draft.about}
                    onChange={(event) => updateDraft("about", event.target.value)}
                    className="mt-2 w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring"
                    placeholder="Tell others a little about your learning journey." aria-invalid={Boolean(errors.about)} />
                  {errors.about && <span className="mt-1 block text-xs text-rose">{errors.about}</span>}
                </label>
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="block text-sm" htmlFor="profile-language">
                    <span className="font-medium text-foreground">Preferred language</span>
                    <select id="profile-language" value={draft.preferredLanguage} onChange={(event) => updateDraft("preferredLanguage", event.target.value)}
                      className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      {languages.map((language) => <option key={language} value={language}>{language}</option>)}
                    </select>
                    {errors.preferredLanguage && <span className="mt-1 block text-xs text-rose">{errors.preferredLanguage}</span>}
                  </label>
                  <label className="block text-sm" htmlFor="profile-difficulty">
                    <span className="flex items-center gap-2 font-medium text-foreground">Difficulty preference
                      <span title="This preference helps personalize your practice recommendations." className="cursor-help text-muted-foreground" aria-label="This preference helps personalize your practice recommendations."><CircleHelp className="h-4 w-4" /></span>
                    </span>
                    <select id="profile-difficulty" value={draft.difficultyBias} onChange={(event) => updateDraft("difficultyBias", event.target.value)}
                      className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      {difficulties.map((difficulty) => <option key={difficulty}>{difficulty}</option>)}
                    </select>
                    {errors.difficultyBias && <span className="mt-1 block text-xs text-rose">{errors.difficultyBias}</span>}
                  </label>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  {editField("GitHub URL", "github", draft.github, { placeholder: "https://github.com/username" })}
                  {editField("LinkedIn URL", "linkedin", draft.linkedin, { placeholder: "https://linkedin.com/in/username" })}
                </div>
                <div className="flex flex-wrap gap-2 border-t border-border pt-4">
                  <Button type="submit" disabled={saving || loading}>
                    {saving ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving...</> : <><Save className="mr-2 h-4 w-4" />Save Changes</>}
                  </Button>
                  <Button type="button" variant="outline" onClick={cancelEditing} disabled={saving}>
                    <X className="mr-2 h-4 w-4" />Cancel
                  </Button>
                </div>
              </form>
            ) : (
              <div className="space-y-5">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="min-w-0"><p className="text-xs text-muted-foreground">Name</p><p className="mt-1 break-words text-sm font-medium">{profile.name || "Not set"}</p></div>
                  <div className="min-w-0"><p className="text-xs text-muted-foreground">Location</p><p className="mt-1 break-words text-sm font-medium">{profile.location || "Not set"}</p></div>
                </div>
                <div>
                  <h3 className="text-sm font-semibold">About Me</h3>
                  {profile.about ? <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-muted-foreground">{profile.about}</p> : (
                    <div className="mt-2 rounded-lg border border-dashed border-border p-4">
                      <p className="text-sm text-muted-foreground">Tell others a little about your learning journey.</p>
                      <button type="button" onClick={startEditing} className="mt-2 text-sm font-medium text-teal hover:underline">Add About</button>
                    </div>
                  )}
                </div>
                <div className="grid gap-4 border-t border-border pt-4 sm:grid-cols-2">
                  <div><p className="text-xs text-muted-foreground">Preferred language</p><p className="mt-1 text-sm font-medium uppercase">{profile.preferredLanguage || "No data yet"}</p></div>
                  <div><p className="text-xs text-muted-foreground">Difficulty preference</p><p className="mt-1 text-sm font-medium">{profile.difficultyBias || "No data yet"}</p></div>
                </div>
                <div className="flex flex-wrap gap-4 border-t border-border pt-4">
                  {githubLink ? <a href={githubLink} target="_blank" rel="noopener noreferrer" className="inline-flex min-w-0 items-center gap-2 break-all text-sm text-teal hover:underline"><Github className="h-4 w-4 shrink-0" />GitHub<ExternalLink className="h-3.5 w-3.5 shrink-0" /></a> : <button type="button" onClick={startEditing} className="text-sm text-muted-foreground hover:text-teal">{profile.github ? "Edit GitHub link" : "Add GitHub"}</button>}
                  {linkedinLink ? <a href={linkedinLink} target="_blank" rel="noopener noreferrer" className="inline-flex min-w-0 items-center gap-2 break-all text-sm text-teal hover:underline"><Linkedin className="h-4 w-4 shrink-0" />LinkedIn<ExternalLink className="h-3.5 w-3.5 shrink-0" /></a> : <button type="button" onClick={startEditing} className="text-sm text-muted-foreground hover:text-teal">{profile.linkedin ? "Edit LinkedIn link" : "Add LinkedIn"}</button>}
                </div>
              </div>
            )}
          </section>

          <div className="space-y-6">
            <section className="rounded-card border border-border bg-bg-surface p-5 sm:p-6" aria-labelledby="profile-completion-heading">
              <div className="flex items-start justify-between gap-4">
                <div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-teal">Profile Completion</p><h2 id="profile-completion-heading" className="mt-1 text-xl font-semibold">{completion}% complete</h2></div>
                <span className="text-2xl font-bold text-teal">{completion}%</span>
              </div>
              <div className="mt-4 h-2 overflow-hidden rounded-full bg-bg-hover" role="progressbar" aria-valuenow={completion} aria-valuemin={0} aria-valuemax={100}>
                <div className="h-full rounded-full bg-teal transition-all" style={{ width: `${completion}%` }} />
              </div>
              <ul className="mt-4 grid grid-cols-2 gap-2 text-xs">
                {completionItems.map((item) => <li key={item.label} className={`flex items-center gap-2 ${item.done ? "text-foreground" : "text-muted-foreground"}`}>
                  {item.done ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <span className="h-3.5 w-3.5 rounded-full border border-border" />}
                  {item.label}
                </li>)}
              </ul>
              {completion < 100 && <Button variant="outline" size="sm" className="mt-4" onClick={startEditing}>Complete Profile</Button>}
            </section>

            <section className="rounded-card border border-border bg-bg-surface p-5 sm:p-6" aria-labelledby="learning-snapshot-heading">
              <div className="flex items-center justify-between gap-2">
                <div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-teal">Your progress</p><h2 id="learning-snapshot-heading" className="mt-1 text-xl font-semibold">Learning Snapshot</h2><p className="mt-1 text-xs text-muted-foreground">Learning activity: last 365 days. Assignment totals: available joined rooms.</p></div>
                {activityLoading && <Loader2 className="h-4 w-4 animate-spin text-teal" aria-label="Loading learning activity" />}
              </div>
              <div className="mt-5 grid grid-cols-2 gap-3">
                <SnapshotMetric label={isTeacher ? "Assignment Rooms" : "Problems Solved"} value={activityLoadError ? null : isTeacher ? assignmentStats?.assignments : problemsSolved} />
                <SnapshotMetric label="Code Runs" value={activityLoadError || !activityItems.length ? null : codeRuns} />
                <SnapshotMetric label={isTeacher ? "Students" : "Assignments Submitted"} value={isTeacher ? assignmentStats?.students : assignmentStats?.completed} />
                {isTeacher ? (
                  <>
                    <SnapshotMetric label="Student Completions" value={assignmentStats?.completed} />
                    <SnapshotMetric label="Feedback Given" value={assignmentStats?.feedbackGiven} />
                    <SnapshotMetric label="Learning Days" value={activityLoadError || !streaks.totalDays ? null : streaks.totalDays} />
                  </>
                ) : (
                  <>
                    <SnapshotMetric label="Assignment Rooms" value={assignmentStats?.assignments} />
                    <SnapshotMetric label="Assignments In Progress" value={assignmentStats?.inProgress} />
                    <SnapshotMetric label="Assignments Not Started" value={assignmentStats?.pending} />
                    <SnapshotMetric label="Current Streak" value={activityLoadError || !streaks.totalDays ? null : streaks.current} suffix=" days" />
                    <SnapshotMetric label="Longest Streak" value={activityLoadError || !streaks.totalDays ? null : streaks.longest} suffix=" days" />
                    <SnapshotMetric label="Learning Days" value={activityLoadError || !streaks.totalDays ? null : streaks.totalDays} />
                  </>
                )}
              </div>
              {isTeacher && <p className="mt-3 text-xs text-muted-foreground">Counts only; student-specific information remains in the teacher dashboard.</p>}
            </section>
          </div>
        </div>

        <section className="rounded-card border border-border bg-bg-surface p-5 sm:p-6" aria-labelledby="analytics-heading">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-teal">Real activity data</p>
              <h2 id="analytics-heading" className="mt-1 text-xl font-semibold">Learning Analytics</h2>
              <p className="mt-1 text-xs text-muted-foreground">Activity is from the last 365 days; each activity source returns up to its newest 1,000 records. Assignment status covers available joined rooms.</p>
            </div>
          </div>
          {activityLoadError && <p role="alert" className="mt-4 rounded-lg border border-rose/30 bg-rose/5 p-3 text-sm text-rose">Some activity could not be loaded. Displayed activity charts and achievements may be incomplete.</p>}
          <div className="mt-5 grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1.5fr),minmax(260px,1fr)]">
            <div className="min-w-0 rounded-lg border border-border bg-background p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold">Coding Activity</h3>
                  <p className="mt-1 text-xs text-muted-foreground">{activityPeriod} day view · code runs and solved problems</p>
                </div>
                <div className="flex rounded-md border border-border p-1" aria-label="Activity chart period">
                  {([7, 30, 90] as const).map((days) => (
                    <button key={days} type="button" aria-pressed={activityPeriod === days}
                      onClick={() => setActivityPeriod(days)}
                      className={`rounded px-2.5 py-1 text-xs transition-colors ${activityPeriod === days ? "bg-teal text-background" : "text-muted-foreground hover:text-foreground"}`}>
                      {days}d
                    </button>
                  ))}
                </div>
              </div>
              <div className="mt-4 h-56 w-full" role="img" aria-label={`Daily code runs and solved problems over the last ${activityPeriod} days`}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={periodActivity} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                    <XAxis dataKey="label" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} tickLine={false} axisLine={false} minTickGap={12} />
                    <YAxis allowDecimals={false} width={30} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} tickLine={false} axisLine={false} />
                    <Tooltip
                      cursor={{ fill: "rgba(0,212,170,0.08)" }}
                      contentStyle={{ backgroundColor: "hsl(var(--background))", borderColor: "hsl(var(--border))", borderRadius: 8, color: "hsl(var(--foreground))" }}
                      labelFormatter={(_, payload) => {
                        const key = payload?.[0]?.payload?.date;
                        return typeof key === "string" ? formatActivityDate(new Date(`${key}T12:00:00`)) : "";
                      }}
                      formatter={(value, name) => [`${value} ${value === 1 ? "event" : "events"}`, name]}
                    />
                    <Bar dataKey="codeRuns" name="Code runs" fill="hsl(var(--accent-teal))" radius={[3, 3, 0, 0]} maxBarSize={24} />
                    <Bar dataKey="problemsSolved" name="Problems solved" fill="hsl(var(--accent-ice))" radius={[3, 3, 0, 0]} maxBarSize={24} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              {!activityItems.length && !activityLoading && <p className="mt-2 text-center text-xs text-muted-foreground">{activityLoadError ? "Activity data is unavailable." : "No recorded activity for this period."}</p>}
            </div>

            <div className="min-w-0 rounded-lg border border-border bg-background p-4">
              <h3 className="text-sm font-semibold">Language Usage</h3>
              <p className="mt-1 text-xs text-muted-foreground">Code runs with a recorded language.</p>
              {languageUsage.length ? (
                <div className="mt-3 h-56 w-full" role="img" aria-label="Recorded code runs by programming language">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={languageUsage.slice(0, 6)} layout="vertical" margin={{ top: 4, right: 10, left: 4, bottom: 4 }}>
                      <XAxis type="number" allowDecimals={false} hide />
                      <YAxis dataKey="language" type="category" width={84} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} tickLine={false} axisLine={false} />
                      <Tooltip
                        cursor={{ fill: "rgba(0,212,170,0.08)" }}
                        contentStyle={{ backgroundColor: "hsl(var(--background))", borderColor: "hsl(var(--border))", borderRadius: 8, color: "hsl(var(--foreground))" }}
                        formatter={(value) => [`${value} run${value === 1 ? "" : "s"}`, "Usage"]}
                      />
                      <Bar dataKey="count" name="Code runs" fill="hsl(var(--accent-teal))" radius={[0, 3, 3, 0]} maxBarSize={20} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : <p className="mt-6 rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
                {activityLoading ? "Loading language activity..." : activityLoadError ? "Language data is unavailable." : "No recorded code runs with language data yet."}
              </p>}
            </div>
          </div>
          {(isTeacher || userRole === "student") && (
            <div className="mt-5 rounded-lg border border-border bg-background p-4" aria-labelledby="assignment-progress-heading">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 id="assignment-progress-heading" className="text-sm font-semibold">{isTeacher ? "Student Assignment Progress" : "Assignment Progress"}</h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {assignmentStats
                      ? isTeacher
                        ? `${assignmentStats.assignments} rooms · ${assignmentStats.students} distinct students`
                        : `${assignmentStats.assignments} joined teacher assignment rooms`
                      : activityLoading ? "Loading assignment records..." : "Assignment records are unavailable."}
                  </p>
                </div>
                {activityLoading && <Loader2 className="h-4 w-4 animate-spin text-teal" aria-label="Loading assignment progress" />}
              </div>
              {assignmentStats ? (
                <>
                  <div className="mt-4 flex h-3 overflow-hidden rounded-full bg-bg-hover" role="img"
                    aria-label={`${assignmentStats.completed} submitted, ${assignmentStats.inProgress} in progress, ${assignmentStats.pending} not started`}>
                    {([
                      { value: assignmentStats.completed, color: "bg-emerald-400" },
                      { value: assignmentStats.inProgress, color: "bg-teal" },
                      { value: assignmentStats.pending, color: "bg-slate-600" },
                    ]).map((segment) => segment.value > 0 && (
                      <span key={segment.color} className={segment.color}
                        style={{ width: `${assignmentStats.totalParticipants ? segment.value / assignmentStats.totalParticipants * 100 : 0}%` }} />
                    ))}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground">
                    <span><i className="mr-1.5 inline-block h-2 w-2 rounded-full bg-emerald-400" />Submitted: {assignmentStats.completed}</span>
                    <span><i className="mr-1.5 inline-block h-2 w-2 rounded-full bg-teal" />In progress: {assignmentStats.inProgress}</span>
                    <span><i className="mr-1.5 inline-block h-2 w-2 rounded-full bg-slate-600" />Not started: {assignmentStats.pending}</span>
                  </div>
                </>
              ) : <p className="mt-3 text-sm text-muted-foreground">Assignment data is unavailable. Check the assignment database migration and connection status.</p>}
            </div>
          )}
        </section>

        <section className="min-w-0 rounded-card border border-border bg-bg-surface p-5 sm:p-6" aria-labelledby="activity-heading">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-teal">Learning history</p><h2 id="activity-heading" className="mt-1 text-xl font-semibold">Activity · last 365 days</h2></div>
            <span className="text-xs text-muted-foreground">{activityItems.length} recorded events · {streaks.totalDays} active days</span>
          </div>
          <div className="mt-5 overflow-x-auto pb-2" aria-label="365-day activity heatmap">
            <div className="grid w-max grid-flow-col grid-rows-7 gap-[3px]">
              {weeks.flatMap((week, weekIndex) => week.map((cell, dayIndex) => cell
                ? <button key={cell.key} type="button" onClick={() => setSelectedDay((current) => current === cell.key ? null : cell.key)}
                    title={`${formatActivityDate(cell.date)} · ${cell.count} activit${cell.count === 1 ? "y" : "ies"}`}
                    aria-label={`${formatActivityDate(cell.date)}: ${cell.count} activit${cell.count === 1 ? "y" : "ies"}`}
                    className={`h-3 w-3 rounded-[3px] transition-transform hover:scale-125 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal ${selectedDay === cell.key ? "ring-2 ring-foreground" : ""}`}
                    style={{ backgroundColor: cell.level === 0 ? "hsl(210,15%,12%)" : `rgba(0,212,170,${0.2 + cell.level * 0.18})` }} />
                : <span key={`empty-${weekIndex}-${dayIndex}`} className="h-3 w-3" />))}
            </div>
          </div>
          <div className="mt-3 flex items-center justify-end gap-2 text-xs text-muted-foreground">
            <span>Less</span>{[0, 1, 2, 3, 4].map((level) => <span key={level} className="h-3 w-3 rounded-[3px]" style={{ backgroundColor: level === 0 ? "hsl(210,15%,12%)" : `rgba(0,212,170,${0.2 + level * 0.18})` }} />)}<span>More</span>
          </div>
          {selectedDay && <div className="mt-4 rounded-lg border border-border bg-background p-4">
            <h3 className="text-sm font-semibold">{formatActivityDate(new Date(`${selectedDay}T12:00:00`))}</h3>
            <p className="mt-1 text-xs text-muted-foreground">{selectedDayEvents.length} activit{selectedDayEvents.length === 1 ? "y" : "ies"}</p>
            {selectedDayEvents.length > 0 && <div className="mt-2 flex flex-wrap gap-2">
              {Object.entries(selectedDayBreakdown).map(([kind, count]) => (
                <span key={kind} className="rounded-full border border-border px-2 py-1 text-xs text-muted-foreground">
                  {kind === "run" ? "Code runs" : kind === "problem" ? "Problems solved" : kind === "assessment" ? "Assessments" : kind === "assignment" ? "Assignments" : "Feedback"}: {count}
                </span>
              ))}
            </div>}
            {selectedDayEvents.length > 0 && <ul className="mt-2 space-y-1 text-sm">{selectedDayEvents.map((event) => <li key={event.id}>{event.title}</li>)}</ul>}
          </div>}
          {activityItems.length === 0 && !activityLoading && <p className="mt-4 text-sm text-muted-foreground">{activityLoadError ? "Activity data is unavailable." : "No activity data yet."}</p>}
        </section>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.3fr),minmax(280px,1fr)]">
          <section className="rounded-card border border-border bg-bg-surface p-5 sm:p-6" aria-labelledby="recent-activity-heading">
            <div className="flex items-center justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-teal">Your timeline</p><h2 id="recent-activity-heading" className="mt-1 text-xl font-semibold">Recent Activity</h2></div>{activityLoading && <Loader2 className="h-4 w-4 animate-spin text-teal" />}</div>
            {recentActivity.length ? <ul className="mt-4 space-y-3">{recentActivity.map((item) => <li key={item.id} className="flex min-w-0 items-start gap-3 border-b border-border/70 pb-3 last:border-0">
              <ActivityIcon kind={item.kind} />
              <div className="min-w-0 flex-1"><p className="break-words text-sm">{item.title}</p><p className="mt-1 text-xs text-muted-foreground">{relativeTime(item.at)}</p></div>
            </li>)}</ul> : !activityLoading ? <p className="mt-4 rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">{activityLoadError ? "Activity history is temporarily unavailable." : "No recent activity yet."}</p> : null}
          </section>

          <section className="rounded-card border border-border bg-bg-surface p-5 sm:p-6" aria-labelledby="achievements-heading">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-teal">Recognition</p>
                <h2 id="achievements-heading" className="mt-1 text-xl font-semibold">Achievements</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  {activityLoadError ? "Status unavailable" : `${learningAchievements.filter((item) => item.earned).length} of ${learningAchievements.length} earned from the last 365 days of recorded activity.`}
                </p>
              </div>
              <Award className="h-5 w-5 text-teal" aria-hidden="true" />
            </div>
            <div className="mt-4 flex flex-wrap gap-2" aria-label="Filter achievements">
              {([
                ["all", "All"],
                ["earned", "Earned"],
                ["locked", "Locked"],
              ] as const).map(([filter, label]) => (
                <button key={filter} type="button" aria-pressed={achievementFilter === filter}
                  onClick={() => setAchievementFilter(filter)}
                  className={`rounded-full border px-3 py-1 text-xs transition-colors ${achievementFilter === filter ? "border-teal bg-teal/10 text-teal" : "border-border text-muted-foreground hover:text-foreground"}`}>
                  {label}
                </button>
              ))}
            </div>
            {activityLoadError ? <p role="status" className="mt-4 rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">Achievement status is unavailable until learning activity loads successfully.</p> : <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {filteredAchievements.map((achievement) => (
                <button key={achievement.key} type="button" onClick={() => setSelectedAchievement(achievement)}
                  className="min-w-0 rounded-lg border border-border bg-background p-3 text-left transition-colors hover:border-teal/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal">
                  <div className="flex items-start gap-3">
                    <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${achievement.earned ? "bg-teal/10 text-teal" : "bg-bg-hover text-muted-foreground"}`}>
                      <AchievementIcon icon={achievement.icon} earned={achievement.earned} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium">{achievement.name}</span>
                        {achievement.earned ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" /> : <LockKeyhole className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                      </span>
                      <span className="mt-1 block text-xs text-muted-foreground">{achievement.category}</span>
                    </span>
                  </div>
                  <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                    <span>{achievement.earned ? "Earned" : "Progress"}</span>
                    <span>{achievement.progress} / {achievement.target}</span>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-bg-hover" role="progressbar"
                    aria-label={`${achievement.name} progress`} aria-valuenow={achievement.progress}
                    aria-valuemin={0} aria-valuemax={achievement.target}>
                    <span className={`block h-full rounded-full ${achievement.earned ? "bg-emerald-400" : "bg-teal"}`}
                      style={{ width: `${Math.min(100, achievement.progress / achievement.target * 100)}%` }} />
                  </div>
                </button>
              ))}
            </div>}
            {!activityLoadError && !filteredAchievements.length && <p className="mt-4 rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">No achievements in this filter yet.</p>}
            <p className="mt-4 text-xs text-muted-foreground">Achievements are calculated from your recorded activity. Unavailable assignment data is not presented as an achievement.</p>
          </section>
        </div>

        <section className="rounded-card border border-border bg-bg-surface p-5 sm:p-6" aria-labelledby="account-settings-heading">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-teal">Account</p>
          <h2 id="account-settings-heading" className="mt-1 text-xl font-semibold">Account Settings</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div className="min-w-0"><p className="text-xs text-muted-foreground">Email</p><p className="mt-1 break-all text-sm">{user.email || "Not available"}</p><p className="mt-1 text-xs text-muted-foreground">Email changes are managed by your sign-in provider.</p></div>
            <div><p className="text-xs text-muted-foreground">Account role</p><p className="mt-1 inline-flex items-center gap-2 text-sm"><GraduationCap className="h-4 w-4 text-teal" />{isTeacher ? "Teacher" : "Student"}</p><p className="mt-1 text-xs text-muted-foreground">Role is managed by the account authorization system.</p></div>
          </div>
          <div className="mt-5 border-t border-border pt-5">
            <button type="button" onClick={() => setChangingPassword((current) => !current)} className="inline-flex items-center gap-2 text-sm font-medium text-teal hover:underline">
              <LockKeyhole className="h-4 w-4" />{changingPassword ? "Cancel password change" : "Change Password"}
            </button>
            {changingPassword && <form onSubmit={(event) => void onChangePassword(event)} className="mt-4 grid gap-3 sm:max-w-xl sm:grid-cols-2">
              <Input type="password" autoComplete="new-password" minLength={8} required aria-label="New password" placeholder="New password" value={password} onChange={(event) => setPassword(event.target.value)} />
              <Input type="password" autoComplete="new-password" minLength={8} required aria-label="Confirm new password" placeholder="Confirm new password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} />
              <Button type="submit" disabled={passwordSaving || !hasSupabaseEnv} className="sm:col-span-2">{passwordSaving ? "Updating..." : "Update Password"}</Button>
            </form>}
          </div>
        </section>

        <section className="rounded-card border border-rose/20 bg-bg-surface p-5 sm:p-6" aria-labelledby="danger-zone-heading">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-rose">Danger Zone</p>
          <h2 id="danger-zone-heading" className="mt-1 text-xl font-semibold">Sign out of MindCode</h2>
          <p className="mt-1 text-sm text-muted-foreground">Account deletion is not available here because this app has no secure account-deletion flow configured.</p>
          <Button variant="outline" onClick={() => void onLogout()} disabled={loggingOut} className="mt-4 border-rose/30 text-rose hover:bg-rose/10">
            {loggingOut ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Logging out...</> : "Log Out"}
          </Button>
        </section>
      </main>
      <AlertDialog open={removePhotoOpen} onOpenChange={setRemovePhotoOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove profile picture?</AlertDialogTitle>
            <AlertDialogDescription>
              Your initials will appear instead. The photo will be removed from storage after you save your profile.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmPhotoRemoval} className="bg-rose text-white hover:bg-rose/90">Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <Dialog open={selectedAchievement !== null} onOpenChange={(open) => !open && setSelectedAchievement(null)}>
        <DialogContent>
          {selectedAchievement && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <AchievementIcon icon={selectedAchievement.icon} earned={selectedAchievement.earned} />
                  {selectedAchievement.name}
                </DialogTitle>
                <DialogDescription>{selectedAchievement.description}</DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">Category: {selectedAchievement.category}</p>
                <div className="flex items-center justify-between text-sm">
                  <span>{selectedAchievement.earned ? "Earned" : "Current progress"}</span>
                  <span className="font-medium">{selectedAchievement.progress} / {selectedAchievement.target}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-bg-hover" role="progressbar"
                  aria-label={`${selectedAchievement.name} progress`} aria-valuenow={selectedAchievement.progress}
                  aria-valuemin={0} aria-valuemax={selectedAchievement.target}>
                  <span className="block h-full rounded-full bg-teal"
                    style={{ width: `${Math.min(100, selectedAchievement.progress / selectedAchievement.target * 100)}%` }} />
                </div>
                {selectedAchievement.earned && selectedAchievement.earnedAt
                  ? <p className="text-sm text-emerald-400">Earned {formatActivityDate(new Date(selectedAchievement.earnedAt))}</p>
                  : !selectedAchievement.earned && <p className="text-sm text-muted-foreground">Keep learning to unlock this achievement.</p>}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

const SnapshotMetric = ({ label, value, suffix = "" }: { label: string; value: number | null | undefined; suffix?: string }) => (
  <div className="min-w-0 rounded-lg border border-border bg-background p-3">
    <p className="break-words text-xs text-muted-foreground">{label}</p>
    <p className="mt-1 text-xl font-semibold text-foreground">{value === null || value === undefined ? "No data yet" : `${value}${suffix}`}</p>
  </div>
);

const AchievementIcon = ({ icon, earned }: { icon: Achievement["icon"]; earned: boolean }) => {
  const Icon = icon === "code" || icon === "python" ? Code2
    : icon === "check" ? CheckCircle2
    : icon === "assignment" ? BookOpen
    : icon === "streak" ? Flame
    : icon === "learning" ? Target
    : GraduationCap;
  return <Icon className={`h-4 w-4 ${earned ? "text-teal" : "text-muted-foreground"}`} aria-hidden="true" />;
};

const ActivityIcon = ({ kind }: { kind: ActivityItem["kind"] }) => {
  const Icon = kind === "assessment" || kind === "problem" ? Check : kind === "run" ? BookOpen : kind === "feedback" ? GraduationCap : Pencil;
  return <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-teal/10 text-teal"><Icon className="h-3.5 w-3.5" /></span>;
};

const ProfileIntroVideo = () => {
  const [unavailable, setUnavailable] = useState(false);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updatePreference = () => setPrefersReducedMotion(mediaQuery.matches);
    updatePreference();
    mediaQuery.addEventListener("change", updatePreference);
    return () => mediaQuery.removeEventListener("change", updatePreference);
  }, []);

  return (
    <div className="min-w-0 overflow-hidden rounded-xl border border-border bg-background shadow-lg shadow-black/20">
      {!unavailable ? (
        <video
          src="/profile.mp4"
          aria-label="Profile introduction video"
          autoPlay={!prefersReducedMotion}
          muted
          loop={!prefersReducedMotion}
          playsInline
          controls
          preload="metadata"
          onError={() => setUnavailable(true)}
          className="aspect-video w-full bg-black object-cover"
        >
          Your browser does not support embedded videos.
        </video>
      ) : (
        <div className="flex aspect-video w-full items-center justify-center bg-gradient-to-br from-bg-hover to-background p-4 text-center text-sm text-muted-foreground" role="status">
          Profile video unavailable
        </div>
      )}
    </div>
  );
};

export default Profile;
