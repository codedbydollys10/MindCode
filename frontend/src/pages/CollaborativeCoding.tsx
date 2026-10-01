import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import Editor, { type OnMount } from "@monaco-editor/react";
import { MonacoBinding } from "y-monaco";
import { ArrowRight, BookOpen, Check, Copy, GraduationCap, Loader2, Play, Save, Sparkles, Users, Wifi, WifiOff, X } from "lucide-react";
import Navbar from "@/components/Navbar";
import UserAvatar from "@/components/UserAvatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSupabaseAuth } from "@/hooks/useSupabaseAuth";
import { useCollaborationRoom } from "@/hooks/useCollaborationRoom";
import { runCode } from "@/lib/codeRunner";
import { getSupabaseClient } from "@/lib/supabase";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const languages = ["python", "javascript", "java", "cpp", "c", "go", "rust"] as const;
type SupportedLanguage = (typeof languages)[number];
type PendingRoomRequest = {
  id: string;
  user_id: string;
  requester_name: string;
  requested_at: string;
};
type TrackedError = {
  id: string;
  timestamp: string;
  language: SupportedLanguage;
  type: "compile" | "runtime" | "unknown";
  message: string;
  line: number | null;
  column: number | null;
  codeHash?: string;
};
type RoomExecution = { output: string; error: TrackedError | null; codeHash: string };
type RoomFeedback = { id: string; author_id: string; message: string; line_number: number | null; created_at: string };
type AssignmentProgress = {
  code_runs: number;
  attempts: number;
  errors: number;
  submission_status: "Pending" | "Submitted";
  submitted_at: string | null;
};
type AssignmentFeedback = { id: string; author_id?: string; message: string; concept?: string | null; is_read: boolean; created_at: string };
type AssignmentRequest = { id: string; status: "pending" | "fulfilled"; requested_at: string; message?: string };
type AssignmentSubmission = { id: string; code: string; attempt: number; submitted_at: string };
type AssignmentExecution = { id: string; has_error: boolean; ran_at: string };
type AssignmentStudent = {
  userId: string;
  progress: AssignmentProgress;
  savedCode: string;
  currentCode: string;
  savedAt: string | null;
  submissions: AssignmentSubmission[];
  executionHistory: AssignmentExecution[];
  feedback: AssignmentFeedback[];
  feedbackRequests: AssignmentRequest[];
};
type CorrectionSuggestion = {
  diagnosis: string;
  errorLine: number | null;
  correction: string;
  correctedCode: string;
  explanation: string;
  changes: string[];
  codeHash: string;
};

const API_BASE = import.meta.env.VITE_COLLABORATION_API_URL
  || import.meta.env.VITE_CODE_RUNNER_URL
  || (import.meta.env.DEV ? "http://localhost:3001" : "https://mindcode-4v9p.onrender.com");

const hashCode = async (code: string) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(code));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
};

const CollaborativeCoding = () => {
  const { roomId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user, userRole, loading: authLoading } = useSupabaseAuth();
  const inviteCode = searchParams.get("invite");
  const teacherInviteCode = searchParams.get("teacherInvite");
  const { room, document, participants, status, error } = useCollaborationRoom(roomId, user?.id, inviteCode, teacherInviteCode);
  const isAssignmentTeacher = room?.roomType === "teacher_assignment" && userRole === "teacher" && room.teacherId === user?.id;
  const isAssignmentStudent = room?.roomType === "teacher_assignment" && userRole === "student" && room.role === "member";
  const [language, setLanguage] = useState<SupportedLanguage>("python");
  const [roomIdInput, setRoomIdInput] = useState("");
  const [inviteCodeInput, setInviteCodeInput] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [running, setRunning] = useState(false);
  const [stdin, setStdin] = useState("");
  const [output, setOutput] = useState("");
  const [runError, setRunError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pendingRequests, setPendingRequests] = useState<PendingRoomRequest[]>([]);
  const [reviewingRequestId, setReviewingRequestId] = useState<string | null>(null);
  const [requestActionError, setRequestActionError] = useState<string | null>(null);
  const [execution, setExecution] = useState<RoomExecution | null>(null);
  const [trackedErrors, setTrackedErrors] = useState<TrackedError[]>([]);
  const [selectedError, setSelectedError] = useState<TrackedError | null>(null);
  const [correction, setCorrection] = useState<CorrectionSuggestion | null>(null);
  const [correctionLoading, setCorrectionLoading] = useState(false);
  const [correctionError, setCorrectionError] = useState<string | null>(null);
  const [correctionStale, setCorrectionStale] = useState(false);
  const [teacherInviteLink, setTeacherInviteLink] = useState("");
  const [teacherInviteLoading, setTeacherInviteLoading] = useState(false);
  const [teacherInviteNotice, setTeacherInviteNotice] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<RoomFeedback[]>([]);
  const [feedbackDraft, setFeedbackDraft] = useState("");
  const [feedbackLine, setFeedbackLine] = useState("");
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const [assignmentDialogOpen, setAssignmentDialogOpen] = useState(false);
  const [assignmentInput, setAssignmentInput] = useState("");
  const [assignmentInputMode, setAssignmentInputMode] = useState<"code" | "link">("code");
  const [assignmentPreview, setAssignmentPreview] = useState<{
    room: { id: string; publicId: string; language: string };
    assignment: NonNullable<ReturnType<typeof useCollaborationRoom>["room"]>["assignment"];
  } | null>(null);
  const [assignmentError, setAssignmentError] = useState<string | null>(null);
  const [assignmentLoading, setAssignmentLoading] = useState(false);
  const [assignmentProgress, setAssignmentProgress] = useState<AssignmentProgress | null>(null);
  const [assignmentSubmissions, setAssignmentSubmissions] = useState<AssignmentSubmission[]>([]);
  const [assignmentExecutionHistory, setAssignmentExecutionHistory] = useState<AssignmentExecution[]>([]);
  const [assignmentFeedback, setAssignmentFeedback] = useState<AssignmentFeedback[]>([]);
  const [feedbackRequests, setFeedbackRequests] = useState<AssignmentRequest[]>([]);
  const [feedbackRequestMessage, setFeedbackRequestMessage] = useState("");
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [assignmentBusy, setAssignmentBusy] = useState(false);
  const [assignmentNotice, setAssignmentNotice] = useState<string | null>(null);
  const [confirmSubmission, setConfirmSubmission] = useState(false);
  const [monitoringStudents, setMonitoringStudents] = useState<AssignmentStudent[]>([]);
  const [monitoringError, setMonitoringError] = useState<string | null>(null);
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);
  const [teacherFeedbackDraft, setTeacherFeedbackDraft] = useState("");
  const [teacherFeedbackConcept, setTeacherFeedbackConcept] = useState("");
  const [editor, setEditor] = useState<Parameters<OnMount>[0] | null>(null);
  const bindingRef = useRef<MonacoBinding | null>(null);

  useEffect(() => {
    if (!document || !editor) return;
    const model = editor.getModel();
    if (!model) return;
    bindingRef.current?.destroy();
    bindingRef.current = new MonacoBinding(document.getText("code"), model, new Set([editor]));
    return () => {
      bindingRef.current?.destroy();
      bindingRef.current = null;
    };
  }, [document, editor]);

  useEffect(() => {
    if (room && languages.includes(room.language as SupportedLanguage)) {
      setLanguage(room.language as SupportedLanguage);
    }
  }, [room]);

  const ownedRoomId = room?.roomType !== "teacher_assignment" && room?.role === "owner" ? room.id : null;

  useEffect(() => {
    if (!ownedRoomId) {
      setPendingRequests([]);
      return;
    }

    let active = true;
    const refreshRequests = async () => {
      try {
        const { data } = await getSupabaseClient().auth.getSession();
        const accessToken = data.session?.access_token;
        if (!accessToken) return;
        const response = await fetch(`${API_BASE}/api/collaboration/rooms/${ownedRoomId}/requests`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const body = await response.json().catch(() => ({}));
        if (active && response.ok) setPendingRequests(body.requests || []);
      } catch {
        // Keep the last known request list visible during transient network errors.
      }
    };

    void refreshRequests();
    const timer = window.setInterval(() => void refreshRequests(), 2000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [ownedRoomId, user?.id]);

  useEffect(() => {
    if (!document) {
      setExecution(null);
      setTrackedErrors([]);
      return;
    }
    const session = document.getMap<string>("roomSession");
    const syncSession = () => {
      try {
        const lastExecution = session.get("lastExecution");
        const parsedExecution = lastExecution ? JSON.parse(lastExecution) as RoomExecution : null;
        setExecution(parsedExecution);
        setOutput(parsedExecution?.output || "");
        setRunError(parsedExecution?.error?.message || null);
        setTrackedErrors(JSON.parse(session.get("trackedErrors") || "[]") as TrackedError[]);
      } catch {
        setExecution(null);
        setOutput("");
        setRunError(null);
        setTrackedErrors([]);
      }
    };
    syncSession();
    session.observe(syncSession);
    return () => session.unobserve(syncSession);
  }, [document]);

  const feedbackRoomId = room?.id ?? null;

  useEffect(() => {
    if (!feedbackRoomId || !user?.id) {
      setFeedback([]);
      return;
    }
    let active = true;
    const refreshFeedback = async () => {
      try {
        const { data } = await getSupabaseClient().auth.getSession();
        const accessToken = data.session?.access_token;
        if (!accessToken) return;
        const response = await fetch(`${API_BASE}/api/collaboration/rooms/${feedbackRoomId}/feedback`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const body = await response.json().catch(() => ({}));
        if (active && response.ok) setFeedback(body.feedback || []);
      } catch {
        // Keep previously loaded room feedback through transient network errors.
      }
    };
    void refreshFeedback();
    const timer = window.setInterval(() => void refreshFeedback(), 5000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [feedbackRoomId, user?.id]);

  const handleCreateRoom = async () => {
    setCreating(true);
    setFormError(null);
    try {
      const { data } = await getSupabaseClient().auth.getSession();
      const accessToken = data.session?.access_token;
      if (!accessToken) throw new Error("Sign in before creating a coding room.");
      const response = await fetch(`${API_BASE}/api/collaboration/rooms`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ language }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Unable to create a coding room.");
      const publicRoomId = body.room?.publicId || body.room?.roomCode || body.room?.id;
      navigate(`/collaborate/${encodeURIComponent(publicRoomId)}?invite=${encodeURIComponent(body.inviteCode)}`);
    } catch (createError) {
      setFormError(createError instanceof Error ? createError.message : "Unable to create a coding room.");
    } finally {
      setCreating(false);
    }
  };

  const handleOpenRoom = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    const id = roomIdInput.trim();
    if (!id) {
      setFormError("Enter the room ID from your invitation.");
      return;
    }
    const inviteQuery = inviteCodeInput.trim() ? `?invite=${encodeURIComponent(inviteCodeInput.trim())}` : "";
    navigate(`/collaborate/${encodeURIComponent(id)}${inviteQuery}`);
  };

  const getAccessToken = async () => {
    const { data, error: sessionError } = await getSupabaseClient().auth.getSession();
    if (sessionError) throw sessionError;
    const accessToken = data.session?.access_token;
    if (!accessToken) throw new Error("Your sign-in session has expired. Please sign in again.");
    return accessToken;
  };

  const getAssignmentCode = () => {
    const value = assignmentInput.trim();
    if (!value) throw new Error(assignmentInputMode === "link" ? "Paste the assignment link shared by your teacher." : "Enter the room code shared by your teacher.");
    if (!/^https?:\/\//i.test(value)) return value;
    const link = new URL(value);
    const codeFromQuery = link.searchParams.get("assignmentCode");
    const segments = link.pathname.split("/").filter(Boolean);
    const roomIndex = segments.lastIndexOf("collaborate");
    const codeFromPath = roomIndex >= 0 ? segments[roomIndex + 1] : null;
    const code = codeFromQuery || codeFromPath;
    if (!code) throw new Error("This link does not contain a MindCode assignment room.");
    return decodeURIComponent(code);
  };

  const handleLookupAssignment = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAssignmentLoading(true);
    setAssignmentError(null);
    setAssignmentPreview(null);
    try {
      const response = await fetch(`${API_BASE}/api/collaboration/assignments/lookup`, {
        method: "POST",
        headers: { Authorization: `Bearer ${await getAccessToken()}`, "Content-Type": "application/json" },
        body: JSON.stringify({ roomCode: getAssignmentCode() }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Unable to find this assignment.");
      setAssignmentPreview(body);
    } catch (lookupError) {
      setAssignmentError(lookupError instanceof Error ? lookupError.message : "Unable to find this assignment.");
    } finally {
      setAssignmentLoading(false);
    }
  };

  const handleJoinAssignment = async () => {
    if (!assignmentPreview) return;
    setAssignmentLoading(true);
    setAssignmentError(null);
    try {
      const response = await fetch(`${API_BASE}/api/collaboration/assignments/${encodeURIComponent(assignmentPreview.room.id)}/join`, {
        method: "POST",
        headers: { Authorization: `Bearer ${await getAccessToken()}`, "Content-Type": "application/json" },
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Unable to join this assignment.");
      setAssignmentDialogOpen(false);
      setAssignmentPreview(null);
      navigate(`/collaborate/${encodeURIComponent(body.room.publicId || body.room.id)}`);
    } catch (joinError) {
      setAssignmentError(joinError instanceof Error ? joinError.message : "Unable to join this assignment.");
    } finally {
      setAssignmentLoading(false);
    }
  };

  const refreshAssignmentData = useCallback(async () => {
    if (!room || room.roomType !== "teacher_assignment") return;
    const token = await getAccessToken();
    if (isAssignmentStudent) {
      const [progressResponse, feedbackResponse] = await Promise.all([
        fetch(`${API_BASE}/api/collaboration/assignments/${room.id}/progress`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${API_BASE}/api/collaboration/assignments/${room.id}/feedback`, { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      const [progressBody, feedbackBody] = await Promise.all([
        progressResponse.json().catch(() => ({})),
        feedbackResponse.json().catch(() => ({})),
      ]);
      if (!progressResponse.ok) throw new Error(progressBody.error || "Unable to load assignment progress.");
      if (!feedbackResponse.ok) throw new Error(feedbackBody.error || "Unable to load teacher feedback.");
      setAssignmentProgress(progressBody.progress);
      setAssignmentSubmissions(progressBody.submissions || []);
      setAssignmentExecutionHistory(progressBody.executionHistory || []);
      setAssignmentFeedback(feedbackBody.feedback || []);
      setFeedbackRequests(feedbackBody.requests || []);
    } else if (isAssignmentTeacher) {
      const response = await fetch(`${API_BASE}/api/collaboration/assignments/${room.id}/monitoring`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Unable to load assignment monitoring.");
      setMonitoringStudents(body.students || []);
    }
  }, [room, isAssignmentStudent, isAssignmentTeacher]);

  const handleSaveAssignment = async () => {
    if (!room || !document || !isAssignmentStudent) return;
    setAssignmentBusy(true);
    setAssignmentNotice(null);
    try {
      const response = await fetch(`${API_BASE}/api/collaboration/assignments/${room.id}/save`, {
        method: "POST",
        headers: { Authorization: `Bearer ${await getAccessToken()}`, "Content-Type": "application/json" },
        body: JSON.stringify({ code: document.getText("code").toString() }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Unable to save assignment work.");
      setSavedAt(body.savedAt);
      setAssignmentNotice("Your work is saved.");
    } catch (saveError) {
      setAssignmentNotice(saveError instanceof Error ? saveError.message : "Unable to save assignment work.");
    } finally {
      setAssignmentBusy(false);
    }
  };

  const handleRequestAssignmentFeedback = async () => {
    if (!room || !isAssignmentStudent) return;
    setAssignmentBusy(true);
    setAssignmentNotice(null);
    try {
      const response = await fetch(`${API_BASE}/api/collaboration/assignments/${room.id}/feedback-requests`, {
        method: "POST",
        headers: { Authorization: `Bearer ${await getAccessToken()}`, "Content-Type": "application/json" },
        body: JSON.stringify({ message: feedbackRequestMessage.trim() }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Unable to request teacher feedback.");
      setFeedbackRequests((current) => [body.request, ...current]);
      setFeedbackRequestMessage("");
      setAssignmentNotice("Your teacher has been asked to review your work.");
    } catch (requestError) {
      setAssignmentNotice(requestError instanceof Error ? requestError.message : "Unable to request teacher feedback.");
    } finally {
      setAssignmentBusy(false);
    }
  };

  const handleMarkFeedbackRead = async (feedbackId: string) => {
    if (!room || !isAssignmentStudent) return;
    try {
      const response = await fetch(`${API_BASE}/api/collaboration/assignments/${room.id}/feedback/${feedbackId}/read`, {
        method: "POST",
        headers: { Authorization: `Bearer ${await getAccessToken()}` },
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Unable to update feedback status.");
      setAssignmentFeedback((current) => current.map((item) => item.id === feedbackId ? { ...item, is_read: true } : item));
    } catch (readError) {
      setAssignmentNotice(readError instanceof Error ? readError.message : "Unable to update feedback status.");
    }
  };

  const handleSubmitAssignment = async () => {
    if (!room || !document || !isAssignmentStudent) return;
    setAssignmentBusy(true);
    setAssignmentNotice(null);
    try {
      const code = document.getText("code").toString();
      const token = await getAccessToken();
      const saveResponse = await fetch(`${API_BASE}/api/collaboration/assignments/${room.id}/save`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const saveBody = await saveResponse.json().catch(() => ({}));
      if (!saveResponse.ok) throw new Error(saveBody.error || "Save your latest work before submitting.");
      setSavedAt(saveBody.savedAt);
      const response = await fetch(`${API_BASE}/api/collaboration/assignments/${room.id}/submit`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Unable to submit this assignment.");
      setAssignmentProgress(body.progress);
      setAssignmentSubmissions((current) => [body.submission, ...current]);
      setConfirmSubmission(false);
      setAssignmentNotice(`Assignment submitted · attempt ${body.submission.attempt}.`);
    } catch (submitError) {
      setAssignmentNotice(submitError instanceof Error ? submitError.message : "Unable to submit this assignment.");
    } finally {
      setAssignmentBusy(false);
    }
  };

  const handleGiveAssignmentFeedback = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!room || !isAssignmentTeacher || !selectedStudentId || !teacherFeedbackDraft.trim()) return;
    setAssignmentBusy(true);
    setMonitoringError(null);
    try {
      const response = await fetch(`${API_BASE}/api/collaboration/assignments/${room.id}/monitoring/${selectedStudentId}/feedback`, {
        method: "POST",
        headers: { Authorization: `Bearer ${await getAccessToken()}`, "Content-Type": "application/json" },
        body: JSON.stringify({ message: teacherFeedbackDraft.trim(), concept: teacherFeedbackConcept.trim() || undefined }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Unable to send feedback.");
      setTeacherFeedbackDraft("");
      setTeacherFeedbackConcept("");
      await refreshAssignmentData();
    } catch (sendError) {
      setMonitoringError(sendError instanceof Error ? sendError.message : "Unable to send feedback.");
    } finally {
      setAssignmentBusy(false);
    }
  };

  const handleRequestDecision = async (requestId: string, decision: "accepted" | "rejected") => {
    if (!room || room.role !== "owner") return;
    setReviewingRequestId(requestId);
    setRequestActionError(null);
    try {
      const { data } = await getSupabaseClient().auth.getSession();
      const accessToken = data.session?.access_token;
      if (!accessToken) throw new Error("Your sign-in session has expired. Please sign in again.");
      const response = await fetch(`${API_BASE}/api/collaboration/rooms/${room.id}/requests/${requestId}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Unable to review this access request.");
      setPendingRequests((current) => current.filter((request) => request.id !== requestId));
    } catch (decisionError) {
      setRequestActionError(decisionError instanceof Error ? decisionError.message : "Unable to review this access request.");
    } finally {
      setReviewingRequestId(null);
    }
  };

  const handleCreateTeacherInvite = async () => {
    if (!room || room.role !== "owner") return;
    setTeacherInviteLoading(true);
    setTeacherInviteNotice(null);
    try {
      const { data } = await getSupabaseClient().auth.getSession();
      const accessToken = data.session?.access_token;
      if (!accessToken) throw new Error("Your sign-in session has expired. Please sign in again.");
      const response = await fetch(`${API_BASE}/api/collaboration/rooms/${room.id}/teacher-invites`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ inviteCode: teacherInviteLink ? new URL(teacherInviteLink).searchParams.get("teacherInvite") : undefined }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Unable to generate a teacher invitation.");
      const link = new URL(`/collaborate/${encodeURIComponent(room.publicId || room.roomCode || room.id)}`, window.location.origin);
      link.searchParams.set("teacherInvite", body.inviteCode);
      setTeacherInviteLink(link.toString());
    } catch (inviteError) {
      setTeacherInviteNotice(inviteError instanceof Error ? inviteError.message : "Unable to generate a teacher invitation.");
    } finally {
      setTeacherInviteLoading(false);
    }
  };

  const handleCopyTeacherInvite = async () => {
    if (!teacherInviteLink) return;
    try {
      await navigator.clipboard.writeText(teacherInviteLink);
      setTeacherInviteNotice("Teacher invite link copied.");
    } catch {
      setTeacherInviteNotice("Unable to copy the teacher invitation in this browser.");
    }
  };

  const handleSubmitFeedback = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!room || room.role !== "teacher" || !feedbackDraft.trim()) return;
    setFeedbackSubmitting(true);
    setFeedbackError(null);
    try {
      const { data } = await getSupabaseClient().auth.getSession();
      const accessToken = data.session?.access_token;
      if (!accessToken) throw new Error("Your sign-in session has expired. Please sign in again.");
      const response = await fetch(`${API_BASE}/api/collaboration/rooms/${room.id}/feedback`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ message: feedbackDraft.trim(), lineNumber: feedbackLine ? Number(feedbackLine) : null }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Unable to send feedback.");
      setFeedbackDraft("");
      setFeedbackLine("");
      setFeedback((current) => [...current, body.feedback]);
    } catch (submitError) {
      setFeedbackError(submitError instanceof Error ? submitError.message : "Unable to send feedback.");
    } finally {
      setFeedbackSubmitting(false);
    }
  };

  const handleTrackError = () => {
    if (!document || !execution?.error || room?.role === "teacher") return;
    const trackedError = { ...execution.error, id: crypto.randomUUID() };
    const nextErrors = [...trackedErrors, trackedError].slice(-20);
    document.getMap<string>("roomSession").set("trackedErrors", JSON.stringify(nextErrors));
    setSelectedError(trackedError);
    setCorrection(null);
    setCorrectionStale(false);
  };

  const handleSuggestCorrection = async () => {
    const errorToAnalyze = selectedError || execution?.error;
    if (!room || !document || !errorToAnalyze) return;
    setSelectedError(errorToAnalyze);
    const code = document.getText("code").toString();
    if (errorToAnalyze.codeHash && await hashCode(code) !== errorToAnalyze.codeHash) {
      setCorrection(null);
      setCorrectionStale(true);
      setCorrectionError("The code changed after this error was produced. Run it again before requesting AI help.");
      return;
    }
    setCorrectionLoading(true);
    setCorrectionError(null);
    setCorrection(null);
    setCorrectionStale(false);
    try {
      const { data } = await getSupabaseClient().auth.getSession();
      const accessToken = data.session?.access_token;
      if (!accessToken) throw new Error("Your sign-in session has expired. Please sign in again.");
      const response = await fetch(`${API_BASE}/api/collaboration/rooms/${room.id}/error-correction`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          language: room.language,
          code,
          error: {
            type: errorToAnalyze.type,
            message: errorToAnalyze.message,
            line: errorToAnalyze.line,
            column: errorToAnalyze.column,
          },
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "AI correction is temporarily unavailable.");
      setCorrection(body as CorrectionSuggestion);
    } catch (analysisError) {
      setCorrectionError(analysisError instanceof Error ? analysisError.message : "AI correction is temporarily unavailable.");
    } finally {
      setCorrectionLoading(false);
    }
  };

  const handleApplyCorrection = async () => {
    if (!document || !correction || room?.role === "teacher") return;
    const text = document.getText("code");
    if (await hashCode(text.toString()) !== correction.codeHash) {
      setCorrectionStale(true);
      return;
    }
    document.transact(() => {
      text.delete(0, text.length);
      text.insert(0, correction.correctedCode);
    });
    setCorrection(null);
    setCorrectionStale(false);
  };

  const handleRun = async () => {
    if (!document || !room || room.role === "teacher") return;
    setRunning(true);
    setRunError(null);
    setOutput("Running shared code...");
    try {
      const code = document.getText("code").toString();
      const result = await runCode({
        language: room.language as SupportedLanguage,
        code,
        stdin,
      });
      const message = (result.error?.trim()
        || (!/^(accepted|success)$/i.test(result.status || "") ? result.status : "")).slice(0, 4000);
      const lineMatch = message.match(/(?:line\s+|:)(\d+)(?::(\d+))?/i);
      const error = message ? {
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        language: room.language as SupportedLanguage,
        type: result.statusId === 6 || /compile|syntax/i.test(message) ? "compile" as const : "runtime" as const,
        message,
        line: lineMatch ? Number(lineMatch[1]) : null,
        column: lineMatch?.[2] ? Number(lineMatch[2]) : null,
        codeHash: await hashCode(code),
      } : null;
      document.getMap<string>("roomSession").set("lastExecution", JSON.stringify({
        output: (result.output || (!message ? result.status : "") || "No output received.").slice(0, 40000),
        error,
        codeHash: await hashCode(code),
      } satisfies RoomExecution));
      if (isAssignmentStudent) {
        await recordAssignmentRun(Boolean(error));
      }
    } catch (executionError) {
      const message = executionError instanceof Error ? executionError.message : "Unable to run code.";
      const codeHashValue = await hashCode(document.getText("code").toString());
      document.getMap<string>("roomSession").set("lastExecution", JSON.stringify({
        output: message,
        error: {
          id: crypto.randomUUID(),
          timestamp: new Date().toISOString(),
          language: room.language as SupportedLanguage,
          type: "unknown",
          message,
          line: null,
          column: null,
          codeHash: codeHashValue,
        },
        codeHash: codeHashValue,
      } satisfies RoomExecution));
      if (isAssignmentStudent) {
        await recordAssignmentRun(true);
      }
    } finally {
      setRunning(false);
    }
  };

  const recordAssignmentRun = async (hasError: boolean) => {
    if (!room) return;
    try {
      const response = await fetch(`${API_BASE}/api/collaboration/assignments/${room.id}/run`, {
        method: "POST",
        headers: { Authorization: `Bearer ${await getAccessToken()}`, "Content-Type": "application/json" },
        body: JSON.stringify({ hasError }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Unable to record this assignment run.");
      setAssignmentProgress(body.progress);
      if (body.run) setAssignmentExecutionHistory((current) => [body.run, ...current]);
    } catch (trackError) {
      setAssignmentNotice(trackError instanceof Error ? trackError.message : "Unable to record this assignment run.");
    }
  };

  const handleCopyInvite = async () => {
    const publicRoomId = room?.publicId || room?.roomCode || room?.id || roomId || "";
    if (!publicRoomId) {
      setFormError("This room is not ready yet. Please wait for it to load.");
      return;
    }

    const link = room?.roomType === "teacher_assignment"
      ? new URL(`/join/${encodeURIComponent(publicRoomId)}`, window.location.origin)
      : new URL(`/collaborate/${encodeURIComponent(publicRoomId)}`, window.location.origin);
    if (inviteCode && room?.roomType !== "teacher_assignment") link.searchParams.set("invite", inviteCode);

    try {
      await navigator.clipboard.writeText(link.toString());
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setFormError("Unable to copy the invitation link in this browser.");
    }
  };

  useEffect(() => {
    const linkedCode = searchParams.get("assignmentCode");
    if (!roomId && linkedCode) {
      setAssignmentInput(linkedCode);
      setAssignmentInputMode("code");
      setAssignmentDialogOpen(true);
    }
  }, [roomId, searchParams]);

  useEffect(() => {
    if (room?.roomType !== "teacher_assignment") {
      setAssignmentProgress(null);
      setAssignmentSubmissions([]);
      setAssignmentExecutionHistory([]);
      setAssignmentFeedback([]);
      setFeedbackRequests([]);
      setMonitoringStudents([]);
      return;
    }
    let active = true;
    const refresh = async () => {
      try {
        await refreshAssignmentData();
        if (active) setMonitoringError(null);
      } catch (refreshError) {
        const message = refreshError instanceof Error ? refreshError.message : "Unable to refresh assignment details.";
        if (active) {
            if (isAssignmentTeacher) setMonitoringError(message);
          else setAssignmentNotice(message);
        }
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 8000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [refreshAssignmentData, isAssignmentTeacher, room?.roomType]);

  if (authLoading) {
    return <div className="min-h-screen bg-background flex items-center justify-center"><Loader2 className="w-5 h-5 animate-spin text-teal" /></div>;
  }

  if (!user) {
    const returnToRoom = `${window.location.pathname}${window.location.search}`;
    return (
      <div className="min-h-screen bg-background text-foreground">
        <Navbar />
        <main className="max-w-xl mx-auto px-4 pt-28 text-center">
          <h1 className="text-2xl font-semibold">Sign in to collaborate</h1>
          <p className="text-sm text-muted-foreground mt-2">Coding rooms are available to authenticated MindCode users.</p>
          <Button asChild className="mt-5"><Link to={`/login?redirect=${encodeURIComponent(returnToRoom)}`}>Sign in <ArrowRight className="w-4 h-4 ml-2" /></Link></Button>
        </main>
      </div>
    );
  }

  if (!roomId) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <Navbar />
        <main className="mx-auto max-w-6xl px-4 pb-12 pt-24 sm:pt-28">
          <header className="mx-auto max-w-3xl text-center">
            <p className="inline-flex items-center gap-2 rounded-full border border-teal/20 bg-teal/5 px-3 py-1 text-xs font-medium tracking-wide text-teal">
              <span className="h-1.5 w-1.5 rounded-full bg-teal" /> MINDCODE WORKSPACE
            </p>
            <h1 className="mt-5 text-4xl font-bold tracking-tight sm:text-5xl">Collaborate <span className="text-teal">•</span> Learn <span className="text-teal">•</span> Code Together</h1>
            <p className="mx-auto mt-4 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
              Build, practice, and collaborate in real time. Join a teacher assignment or create your own coding room.
            </p>
          </header>

          <section className="mt-10 grid gap-5 lg:grid-cols-2" aria-label="Choose a coding workspace">
            <article className="group rounded-2xl border border-border bg-card/70 p-6 shadow-lg transition-colors hover:border-teal/40 sm:p-8">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-teal/20 bg-teal/10 text-teal">
                <GraduationCap className="h-6 w-6" />
              </div>
              <p className="mt-5 text-xs font-semibold uppercase tracking-[0.16em] text-teal">Teacher-assigned workspace</p>
              <h2 className="mt-2 text-2xl font-semibold">Join Teacher Assignment</h2>
              <p className="mt-3 min-h-12 text-sm leading-6 text-muted-foreground">
                Have a classroom or assignment link from your teacher? Join it using the room code or shared link.
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <Button onClick={() => { setAssignmentInputMode("code"); setAssignmentError(null); setAssignmentPreview(null); setAssignmentDialogOpen(true); }}>
                  <GraduationCap className="mr-2 h-4 w-4" /> Join with Code
                </Button>
                <Button variant="outline" onClick={() => { setAssignmentInputMode("link"); setAssignmentError(null); setAssignmentPreview(null); setAssignmentDialogOpen(true); }}>
                  Open Shared Link <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </div>
            </article>

            <article className="group rounded-2xl border border-border bg-card/70 p-6 shadow-lg transition-colors hover:border-sky-400/40 sm:p-8">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-sky-400/20 bg-sky-400/10 text-sky-300">
                <Users className="h-6 w-6" />
              </div>
              <p className="mt-5 text-xs font-semibold uppercase tracking-[0.16em] text-sky-300">Peer collaboration</p>
              <h2 className="mt-2 text-2xl font-semibold">Create Collaborative Room</h2>
              <p className="mt-3 min-h-12 text-sm leading-6 text-muted-foreground">
                Create your own coding room and invite friends or teammates to collaborate live.
              </p>
              <label className="mt-5 block text-xs font-medium text-muted-foreground" htmlFor="new-room-language">Programming language</label>
              <select
                id="new-room-language"
                className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm uppercase"
                value={language}
                onChange={(event) => setLanguage(event.target.value as SupportedLanguage)}
              >
                {languages.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
              <Button onClick={() => void handleCreateRoom()} disabled={creating} className="mt-4 w-full">
                {creating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Users className="mr-2 h-4 w-4" />}
                Create Room
              </Button>
            </article>
          </section>

          <section className="mx-auto mt-8 max-w-3xl rounded-2xl border border-border bg-bg-surface/80 p-5 sm:p-6">
            <h2 className="text-center text-sm font-semibold">Already have a room code?</h2>
            <form onSubmit={handleOpenRoom} className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
              <Input aria-label="Room ID" placeholder="Enter room code" value={roomIdInput} onChange={(event) => setRoomIdInput(event.target.value)} />
              <Input aria-label="Invite code" placeholder="Optional invite code" value={inviteCodeInput} onChange={(event) => setInviteCodeInput(event.target.value)} />
              <Button type="submit" variant="outline">Join Room <ArrowRight className="ml-2 h-4 w-4" /></Button>
            </form>
            <p className="mt-3 text-center text-xs text-muted-foreground">
              Teacher assignment codes open through <button type="button" className="text-teal underline-offset-4 hover:underline" onClick={() => { setAssignmentInputMode("code"); setAssignmentDialogOpen(true); }}>Join Teacher Assignment</button>.
            </p>
          </section>
          <div className="mt-6 flex justify-center">{formError && <p role="alert" className="text-sm text-rose">{formError}</p>}</div>
        </main>

        <Dialog open={assignmentDialogOpen} onOpenChange={(open) => { setAssignmentDialogOpen(open); if (!open) { setAssignmentPreview(null); setAssignmentError(null); } }}>
          <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
            <DialogHeader>
              <DialogTitle>{assignmentPreview ? "Review assignment" : "Join Assignment"}</DialogTitle>
              <DialogDescription>{assignmentPreview ? "Check the details before entering your personal workspace." : "Enter the code or paste the shared link from your teacher."}</DialogDescription>
            </DialogHeader>
            {assignmentPreview?.assignment ? (
              <div className="space-y-5">
                <div className="rounded-xl border border-teal/20 bg-teal/5 p-5">
                  <p className="text-xs font-semibold uppercase tracking-wide text-teal">Teacher assignment</p>
                  <h3 className="mt-2 text-xl font-semibold">{assignmentPreview.assignment.title}</h3>
                  <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                    <div><dt className="text-xs text-muted-foreground">Teacher</dt><dd className="mt-1">{assignmentPreview.assignment.teacher_name}</dd></div>
                    <div><dt className="text-xs text-muted-foreground">Deadline</dt><dd className="mt-1">{assignmentPreview.assignment.deadline ? new Date(assignmentPreview.assignment.deadline).toLocaleString() : "No deadline"}</dd></div>
                    <div><dt className="text-xs text-muted-foreground">Language</dt><dd className="mt-1 uppercase">{assignmentPreview.room.language}</dd></div>
                    <div><dt className="text-xs text-muted-foreground">Room code</dt><dd className="mt-1 font-mono">{assignmentPreview.room.publicId}</dd></div>
                  </dl>
                  <div className="mt-4 border-t border-border/70 pt-4">
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Instructions</h4>
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-6">{assignmentPreview.assignment.instructions || "No additional instructions provided."}</p>
                  </div>
                </div>
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={() => setAssignmentPreview(null)}>Back</Button>
                  <Button type="button" onClick={() => void handleJoinAssignment()} disabled={assignmentLoading}>
                    {assignmentLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Join Assignment
                  </Button>
                </div>
              </div>
            ) : (
              <form onSubmit={(event) => void handleLookupAssignment(event)} className="space-y-4">
                <label className="block text-sm font-medium" htmlFor="assignment-entry">{assignmentInputMode === "link" ? "Assignment Link" : "Room Code"}</label>
                <Input
                  id="assignment-entry"
                  autoFocus
                  placeholder={assignmentInputMode === "link" ? "Paste your teacher's assignment link" : "e.g. MC-ABC123"}
                  value={assignmentInput}
                  onChange={(event) => setAssignmentInput(event.target.value)}
                />
                {assignmentError && <p role="alert" className="text-sm text-rose">{assignmentError}</p>}
                <Button type="submit" className="w-full" disabled={assignmentLoading}>
                  {assignmentLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Continue
                </Button>
              </form>
            )}
            {assignmentError && assignmentPreview && <p role="alert" className="text-sm text-rose">{assignmentError}</p>}
          </DialogContent>
        </Dialog>

      </div>
    );
  }

  const statusText = status === "connected"
    ? "Connected"
    : status === "reconnecting"
      ? "Reconnecting"
      : status === "error"
        ? "Room unavailable"
        : status === "loading"
          ? "Loading room"
          : status === "pending"
            ? "Waiting for approval"
          : "Connecting";

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Navbar />
      <main className="max-w-[1600px] mx-auto px-4 pt-20 pb-8">
        <div className="flex flex-wrap items-center justify-between gap-3 py-3 border-b border-border">
          <div className="min-w-0">
            <p className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {room?.roomType === "teacher_assignment" ? <><GraduationCap className="h-3.5 w-3.5 text-teal" /> Teacher Assignment</> : "● LIVE WORKSPACE"}
            </p>
            <h1 className="mt-1 truncate text-base font-semibold sm:text-lg">
              {room?.roomType === "teacher_assignment" ? room.assignment?.title : room?.publicId || room?.roomCode || room?.id || roomId}
            </h1>
            {room?.roomType === "teacher_assignment" && (
              <p className="mt-1 text-xs text-muted-foreground">
                {room.assignment?.room_name ? `${room.assignment.room_name} · ` : ""}
                {room.assignment?.teacher_name ? `Teacher: ${room.assignment.teacher_name}` : ""}
                {room.assignment?.deadline ? ` · Due ${new Date(room.assignment.deadline).toLocaleDateString()}` : ""}
              </p>
            )}
            {room?.role === "teacher" && <p className="mt-1 text-xs font-medium text-teal">Teacher Mode · Read-only review</p>}
          </div>
          <div className="flex items-center gap-2">
            {isAssignmentStudent && assignmentProgress && (
              <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${assignmentProgress.submission_status === "Submitted" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400" : "border-sky-400/30 bg-sky-400/10 text-sky-300"}`}>
                {assignmentProgress.submission_status === "Submitted" ? "✓ Submitted" : "● Working"}
              </span>
            )}
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground" role="status">
              {status === "connected" ? <Wifi className="w-3.5 h-3.5 text-teal" /> : <WifiOff className="w-3.5 h-3.5" />}
              {statusText}
            </span>
            {(room?.roomType !== "teacher_assignment" || isAssignmentTeacher) && (
              <Button type="button" variant="outline" size="sm" onClick={() => void handleCopyInvite()} disabled={!room}>
                {copied ? <Check className="w-4 h-4 mr-2" /> : <Copy className="w-4 h-4 mr-2" />}
                {copied ? "Copied" : room?.roomType === "teacher_assignment" ? "Copy assignment link" : "Copy invite"}
              </Button>
            )}
            <Button type="button" variant="ghost" size="sm" onClick={() => navigate("/collaborate")}>Leave room</Button>
          </div>
        </div>

        {room?.role === "owner" && room.roomType !== "teacher_assignment" && (
          <section className="border-b border-border py-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold">Teacher Mode</h2>
                <p className="text-xs text-muted-foreground">Invite a teacher into this room with read-only access.</p>
              </div>
              <Button type="button" size="sm" variant="outline" onClick={() => void handleCreateTeacherInvite()} disabled={teacherInviteLoading}>
                {teacherInviteLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Users className="mr-2 h-4 w-4" />}
                Generate Teacher Invite
              </Button>
            </div>
            {teacherInviteLink && (
              <div className="mt-3 flex flex-wrap gap-2">
                <Input aria-label="Teacher invite link" readOnly value={teacherInviteLink} className="min-w-64 flex-1" />
                <Button type="button" size="sm" onClick={() => void handleCopyTeacherInvite()}><Copy className="mr-2 h-4 w-4" />Copy Link</Button>
              </div>
            )}
            {teacherInviteNotice && <p role="status" className="mt-2 text-xs text-muted-foreground">{teacherInviteNotice}</p>}
          </section>
        )}

        {status === "pending" && error && <p role="status" className="py-2 text-sm text-muted-foreground">{error}</p>}
        {((error && status !== "pending") || formError) && <p role="alert" className="py-2 text-sm text-rose">{error || formError}</p>}

        <div className="grid lg:grid-cols-[minmax(0,1fr)_250px] gap-4 pt-4">
          <section className="min-w-0 border border-border rounded-card overflow-hidden">
            <div className="h-10 px-3 flex items-center justify-between bg-bg-surface border-b border-border">
              <span className="text-xs uppercase text-muted-foreground">{room?.language || language}</span>
              <div className="flex items-center gap-2">
                {room?.roomType !== "teacher_assignment" || isAssignmentStudent ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => void handleSuggestCorrection()}
                    disabled={!room || status !== "connected" || (!execution?.error && !selectedError) || correctionLoading || room.role === "teacher"}
                  >
                    {correctionLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                    Ask AI for assistance
                  </Button>
                ) : null}
                {!isAssignmentTeacher && (
                  <Button type="button" size="sm" onClick={() => void handleRun()} disabled={!room || status !== "connected" || running || room.role === "teacher"}>
                    {running ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Play className="w-4 h-4 mr-2" />}
                    {room?.role === "teacher" ? "Student Run Output" : "Run code"}
                  </Button>
                )}
                {isAssignmentStudent && (
                  <>
                    <Input
                      aria-label="Question for teacher"
                      maxLength={2000}
                      value={feedbackRequestMessage}
                      onChange={(event) => setFeedbackRequestMessage(event.target.value)}
                      placeholder="Question for your teacher (optional)"
                      className="max-w-xs"
                    />
                    <Button type="button" size="sm" variant="outline" onClick={() => void handleSaveAssignment()} disabled={assignmentBusy || status !== "connected"}>
                      {assignmentBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Save
                    </Button>
                    <Button type="button" size="sm" variant="outline" onClick={() => void handleRequestAssignmentFeedback()} disabled={assignmentBusy || feedbackRequests.some((request) => request.status === "pending")}>
                      <BookOpen className="mr-2 h-4 w-4" />Request Feedback
                    </Button>
                    <Button type="button" size="sm" className="bg-teal text-background hover:bg-teal/90" onClick={() => setConfirmSubmission(true)} disabled={assignmentBusy || status !== "connected"}>
                      <Check className="mr-2 h-4 w-4" />Submit Assignment
                    </Button>
                  </>
                )}
              </div>
            </div>
            <div className="h-[55vh] min-h-[360px] max-h-[720px]">
              {isAssignmentTeacher ? (
                <div className="h-full overflow-auto bg-background p-4">
                  {selectedStudentId ? (
                    <pre className="whitespace-pre-wrap font-mono text-sm leading-6">{monitoringStudents.find((student) => student.userId === selectedStudentId)?.currentCode || "No code yet."}</pre>
                  ) : (
                    <div className="flex h-full flex-col items-center justify-center text-center text-sm text-muted-foreground">
                      <GraduationCap className="mb-3 h-8 w-8 text-teal" />
                      <p>Select a student in the monitoring panel to review their latest saved code.</p>
                      <p className="mt-2 text-xs">Student workspaces are private and isolated from one another.</p>
                    </div>
                  )}
                </div>
              ) : document && (
                <Editor
                  height="100%"
                  language={room?.language || language}
                  onMount={setEditor}
                  theme="vs-dark"
                  options={{
                    automaticLayout: true,
                    fontFamily: "JetBrains Mono, monospace",
                    fontSize: 14,
                    minimap: { enabled: false },
                    padding: { top: 12 },
                    readOnly: status !== "connected" || room?.role === "teacher",
                    scrollBeyondLastLine: false,
                  }}
                />
              )}
            </div>
            {!isAssignmentTeacher && <div className="border-t border-border bg-bg-surface p-3 space-y-2">
              <label htmlFor="collaborative-stdin" className="text-xs text-muted-foreground">Standard input</label>
              <Input id="collaborative-stdin" value={stdin} onChange={(event) => setStdin(event.target.value)} placeholder="Optional program input" />
              <div className="min-h-16 max-h-40 overflow-auto rounded-md bg-background border border-border p-3 font-mono text-xs whitespace-pre-wrap" aria-live="polite">
                {output || "Run the shared code to see output."}
              </div>
              {runError && (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-rose/30 p-3">
                  <p className="min-w-0 flex-1 text-xs text-rose">{runError}{execution?.error?.line ? ` · Line ${execution.error.line}` : ""}</p>
                  {room?.role !== "teacher" && <Button type="button" size="sm" variant="outline" onClick={handleTrackError}>Track Error</Button>}
                </div>
              )}
              {trackedErrors.length > 0 && (
                <section className="border-t border-border pt-3">
                  <h3 className="text-sm font-semibold">Tracked Errors</h3>
                  <ul className="mt-2 space-y-2">
                    {trackedErrors.map((trackedError) => (
                      <li key={trackedError.id} className="flex flex-wrap items-center justify-between gap-2 text-xs">
                        <span className="min-w-0 truncate">{trackedError.type === "compile" ? "Compiler error" : "Runtime error"}{trackedError.line ? ` · line ${trackedError.line}` : ""}: {trackedError.message}</span>
                        <Button type="button" size="sm" variant="ghost" onClick={() => { setSelectedError(trackedError); setCorrection(null); setCorrectionError(null); setCorrectionStale(false); }}>Inspect</Button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {selectedError && (
                <section className="border-t border-border pt-3" aria-label="Selected tracked error">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs text-muted-foreground">Selected error{selectedError.line ? ` · line ${selectedError.line}` : ""}</p>
                    <Button type="button" size="sm" onClick={() => void handleSuggestCorrection()} disabled={correctionLoading}>
                      {correctionLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                      {correctionLoading ? "Analyzing error..." : correctionStale ? "Analyze Again" : "Suggest Correction"}
                    </Button>
                  </div>
                  {correctionError && <p role="alert" className="mt-2 text-xs text-rose">{correctionError}</p>}
                  {correctionStale && <p role="alert" className="mt-2 text-xs text-rose">The code has changed since this suggestion was generated. Analyze again before applying.</p>}
                  {correction && (
                    <div className="mt-3 space-y-2 rounded-md border border-border p-3 text-sm">
                      <h3 className="font-semibold">AI Correction</h3>
                      <p><span className="font-medium">Problem:</span> {correction.diagnosis}</p>
                      <p><span className="font-medium">Correction:</span> {correction.correction}</p>
                      <p><span className="font-medium">Why:</span> {correction.explanation}</p>
                      {!!correction.changes.length && <p><span className="font-medium">Changed:</span> {correction.changes.join("; ")}</p>}
                      <details>
                        <summary className="cursor-pointer text-xs text-teal">Show Diff</summary>
                        <div className="mt-2 grid gap-2 md:grid-cols-2">
                          <pre className="max-h-48 overflow-auto rounded bg-bg-surface p-2 text-xs">{document?.getText("code").toString()}</pre>
                          <pre className="max-h-48 overflow-auto rounded bg-bg-surface p-2 text-xs">{correction.correctedCode}</pre>
                        </div>
                      </details>
                      {room?.role !== "teacher" && <Button type="button" size="sm" onClick={() => void handleApplyCorrection()}>Apply Suggested Fix</Button>}
                    </div>
                  )}
                </section>
              )}
            </div>}
          </section>

          <aside className="border-t lg:border-t-0 lg:border-l border-border lg:pl-4 pt-4 lg:pt-0">
            {isAssignmentTeacher ? (
              <div className="space-y-5">
                <section>
                  <h2 className="flex items-center gap-2 text-sm font-semibold"><Users className="h-4 w-4 text-teal" /> Student Monitoring <span className="text-xs text-muted-foreground">{monitoringStudents.length}</span></h2>
                  {monitoringError && <p role="alert" className="mt-2 text-xs text-rose">{monitoringError}</p>}
                  <ul className="mt-3 max-h-64 space-y-2 overflow-auto">
                    {monitoringStudents.map((student) => (
                      <li key={student.userId}>
                        <button type="button" onClick={() => setSelectedStudentId(student.userId)} className={`w-full rounded-lg border p-3 text-left transition-colors ${selectedStudentId === student.userId ? "border-teal/50 bg-teal/5" : "border-border hover:border-border-bright"}`}>
                          <span className="block truncate text-xs font-medium">{student.userId}</span>
                          <span className="mt-1 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                            <span>{student.progress.code_runs} runs · {student.progress.attempts} attempts</span>
                            <span className={student.progress.submission_status === "Submitted" ? "text-emerald-400" : ""}>{student.progress.submission_status}</span>
                          </span>
                          {student.feedbackRequests.some((request) => request.status === "pending") && <span className="mt-1 block text-xs text-amber-300">Feedback requested</span>}
                        </button>
                      </li>
                    ))}
                    {monitoringStudents.length === 0 && <li className="text-xs text-muted-foreground">No students have joined this assignment yet.</li>}
                  </ul>
                </section>
                {selectedStudentId && (() => {
                  const selected = monitoringStudents.find((student) => student.userId === selectedStudentId);
                  if (!selected) return null;
                  return (
                    <section className="border-t border-border pt-4">
                      <h3 className="text-sm font-semibold">Student Work</h3>
                      <p className="mt-1 text-xs text-muted-foreground">Current student code · latest saved {selected.savedAt ? new Date(selected.savedAt).toLocaleString() : "not saved yet"}</p>
                      <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
                        <span>Errors: {selected.progress.errors}</span>
                        <span>Submission: {selected.progress.submission_status}</span>
                      </div>
                      <h4 className="mt-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Submissions</h4>
                      <ul className="mt-2 max-h-32 space-y-1 overflow-auto text-xs">
                        {selected.submissions.map((submission) => <li key={submission.id}>Attempt {submission.attempt} · {new Date(submission.submitted_at).toLocaleString()}</li>)}
                        {selected.submissions.length === 0 && <li className="text-muted-foreground">No submissions yet.</li>}
                      </ul>
                      <h4 className="mt-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Feedback Requests</h4>
                      <ul className="mt-2 space-y-2 text-xs">
                        {selected.feedbackRequests.map((request) => (
                          <li key={request.id} className="rounded border border-border p-2">
                            <p className={request.status === "pending" ? "text-amber-300" : "text-muted-foreground"}>
                              {request.status === "pending" ? "Pending" : "Fulfilled"} · {new Date(request.requested_at).toLocaleString()}
                            </p>
                            {request.message && <p className="mt-1 whitespace-pre-wrap">{request.message}</p>}
                          </li>
                        ))}
                        {selected.feedbackRequests.length === 0 && <li className="text-muted-foreground">No feedback requests.</li>}
                      </ul>
                      <h4 className="mt-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Execution History</h4>
                      <ul className="mt-2 max-h-28 space-y-1 overflow-auto text-xs">
                        {selected.executionHistory.map((run) => <li key={run.id}>{run.has_error ? "Error" : "Completed"} · {new Date(run.ran_at).toLocaleString()}</li>)}
                        {selected.executionHistory.length === 0 && <li className="text-muted-foreground">No code runs yet.</li>}
                      </ul>
                      <form onSubmit={(event) => void handleGiveAssignmentFeedback(event)} className="mt-4 space-y-2">
                        <Input aria-label="Feedback concept" maxLength={120} placeholder="Concept (optional)" value={teacherFeedbackConcept} onChange={(event) => setTeacherFeedbackConcept(event.target.value)} />
                        <textarea aria-label="Assignment teacher feedback" maxLength={2000} className="min-h-20 w-full rounded-md border border-input bg-background p-2 text-sm" placeholder="Write private feedback for this student" value={teacherFeedbackDraft} onChange={(event) => setTeacherFeedbackDraft(event.target.value)} />
                        <Button type="submit" size="sm" disabled={assignmentBusy || !teacherFeedbackDraft.trim()}>{assignmentBusy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Send Feedback</Button>
                      </form>
                      {monitoringError && <p role="alert" className="mt-2 text-xs text-rose">{monitoringError}</p>}
                    </section>
                  );
                })()}
              </div>
            ) : isAssignmentStudent ? (
              <div className="space-y-5">
                <section className="rounded-xl border border-border bg-bg-surface p-4">
                  <h2 className="text-sm font-semibold">Assignment Instructions</h2>
                  <p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-muted-foreground">{room.assignment?.instructions || "No additional instructions provided."}</p>
                </section>
                <section className="rounded-xl border border-border bg-bg-surface p-4">
                  <h2 className="text-sm font-semibold">Assignment Progress</h2>
                  <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                    <dt className="text-muted-foreground">Code runs</dt><dd className="text-right">{assignmentProgress?.code_runs ?? "—"}</dd>
                    <dt className="text-muted-foreground">Attempts</dt><dd className="text-right">{assignmentProgress?.attempts ?? "—"}</dd>
                    <dt className="text-muted-foreground">Errors</dt><dd className="text-right">{assignmentProgress?.errors ?? "—"}</dd>
                    <dt className="text-muted-foreground">Submission</dt><dd className="text-right">{assignmentProgress?.submission_status ?? "Loading"}</dd>
                  </dl>
                  {savedAt && <p className="mt-3 text-xs text-muted-foreground">Saved {new Date(savedAt).toLocaleString()}</p>}
                  <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Recent Executions</h3>
                  <ul className="mt-2 max-h-24 space-y-1 overflow-auto text-xs">
                    {assignmentExecutionHistory.slice(0, 8).map((run) => <li key={run.id}>{run.has_error ? "Error" : "Completed"} · {new Date(run.ran_at).toLocaleString()}</li>)}
                    {assignmentExecutionHistory.length === 0 && <li className="text-muted-foreground">No runs recorded yet.</li>}
                  </ul>
                  <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Submission History</h3>
                  <ul className="mt-2 max-h-24 space-y-1 overflow-auto text-xs">
                    {assignmentSubmissions.map((submission) => (
                      <li key={submission.id}>
                        <details>
                          <summary className="cursor-pointer">Attempt {submission.attempt} · {new Date(submission.submitted_at).toLocaleString()}</summary>
                          <pre className="mt-2 max-h-32 overflow-auto rounded bg-background p-2 font-mono text-[11px]">{submission.code}</pre>
                        </details>
                      </li>
                    ))}
                    {assignmentSubmissions.length === 0 && <li className="text-muted-foreground">No submissions yet.</li>}
                  </ul>
                </section>
                <section className="rounded-xl border border-border bg-bg-surface p-4">
                  <h2 className="text-sm font-semibold">Teacher Feedback</h2>
                  <ul className="mt-3 space-y-3">
                    {assignmentFeedback.map((item) => (
                      <li key={item.id} className="rounded-lg border border-border bg-background p-3 text-xs">
                        <p className="whitespace-pre-wrap leading-5">{item.message}</p>
                        {item.concept && <p className="mt-2 text-teal">Concept: {item.concept}</p>}
                        <p className="mt-2 text-muted-foreground">{room.assignment?.teacher_name ? `Teacher: ${room.assignment.teacher_name} · ` : ""}{new Date(item.created_at).toLocaleString()}</p>
                        {!item.is_read && <Button type="button" size="sm" variant="outline" className="mt-2" onClick={() => void handleMarkFeedbackRead(item.id)}>Mark as Read</Button>}
                      </li>
                    ))}
                    {assignmentFeedback.length === 0 && <li className="text-xs text-muted-foreground">No feedback yet.</li>}
                  </ul>
                  {feedbackRequests.length > 0 && (
                    <div className="mt-3 space-y-2">
                      {feedbackRequests.map((request) => (
                        <p key={request.id} className={`text-xs ${request.status === "pending" ? "text-amber-300" : "text-muted-foreground"}`}>
                          {request.status === "pending" ? "Feedback requested · waiting for your teacher." : "Feedback request fulfilled."}
                          {request.message ? ` ${request.message}` : ""}
                        </p>
                      ))}
                    </div>
                  )}
                  {assignmentNotice && <p role="status" className="mt-3 text-xs text-muted-foreground">{assignmentNotice}</p>}
                </section>
              </div>
            ) : (
              <>
                <h2 className="flex items-center gap-2 text-sm font-semibold"><Users className="w-4 h-4 text-teal" /> Participants <span className="text-xs text-muted-foreground">{participants.length}</span></h2>
                <ul className="mt-3 space-y-2">
                  {participants.map((participant) => (
                    <li key={participant.id} className="flex items-center gap-2 text-sm">
                      <UserAvatar
                        userId={participant.isSelf ? user?.id : undefined}
                        name={participant.name}
                        className="h-7 w-7 text-[10px]"
                      />
                      <span className="truncate">{participant.name}</span>
                      {participant.role === "teacher" && <span className="text-xs text-teal">teacher</span>}
                      {participant.isSelf && <span className="text-xs text-muted-foreground">you</span>}
                    </li>
                  ))}
                  {participants.length === 0 && <li className="text-xs text-muted-foreground">Waiting for room connection…</li>}
                </ul>
                <p className="mt-5 text-xs text-muted-foreground">Edits sync live while connected. The latest room state is saved automatically.</p>
                {(room?.role === "teacher" || feedback.length > 0 || participants.some((participant) => participant.role === "teacher")) && (
                  <section className="mt-6 border-t border-border pt-4">
                    <h2 className="text-sm font-semibold">Teacher Feedback</h2>
                    <ul className="mt-2 space-y-2">
                      {feedback.map((item) => (
                        <li key={item.id} className="border-l-2 border-teal/60 pl-3 text-xs">
                          <p>{item.message}</p>
                          <p className="mt-1 text-muted-foreground">Teacher{item.line_number ? ` · line ${item.line_number}` : ""} · {new Date(item.created_at).toLocaleString()}</p>
                        </li>
                      ))}
                      {room?.role === "teacher" && feedback.length === 0 && <li className="text-xs text-muted-foreground">No feedback has been added yet.</li>}
                    </ul>
                    {room?.role === "teacher" && (
                      <form onSubmit={(event) => void handleSubmitFeedback(event)} className="mt-3 space-y-2">
                        <Input aria-label="Feedback line number" type="number" min="1" placeholder="Optional line number" value={feedbackLine} onChange={(event) => setFeedbackLine(event.target.value)} />
                        <textarea aria-label="Teacher feedback" className="min-h-20 w-full rounded-md border border-input bg-background p-2 text-sm" maxLength={2000} value={feedbackDraft} onChange={(event) => setFeedbackDraft(event.target.value)} placeholder="Add a room-scoped correction suggestion" />
                        <Button type="submit" size="sm" disabled={feedbackSubmitting || !feedbackDraft.trim()}>{feedbackSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Send Feedback</Button>
                        {feedbackError && <p role="alert" className="text-xs text-rose">{feedbackError}</p>}
                      </form>
                    )}
                  </section>
                )}
              </>
            )}
          </aside>
        </div>
      </main>
      {room?.role === "owner" && room.roomType !== "teacher_assignment" && pendingRequests.length > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4" data-testid="room-access-request-dialog">
          <section role="dialog" aria-modal="true" aria-labelledby="room-access-request-title" className="w-full max-w-md rounded-md border border-border bg-background p-5 shadow-xl">
            <p className="text-xs uppercase text-muted-foreground">Room access</p>
            <h2 id="room-access-request-title" className="mt-1 text-lg font-semibold">Join request</h2>
            <p className="mt-1 text-sm text-muted-foreground">Review who can enter {room.publicId || room.roomCode || room.id}.</p>
            <ul className="mt-4 divide-y divide-border">
              {pendingRequests.map((request) => (
                <li key={request.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{request.requester_name}</p>
                    <p className="text-xs text-muted-foreground">Requested {new Date(request.requested_at).toLocaleString()}</p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => void handleRequestDecision(request.id, "accepted")}
                      disabled={reviewingRequestId !== null}
                      aria-label={`Accept ${request.requester_name}`}
                    >
                      {reviewingRequestId === request.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                      <span className="ml-2">Accept</span>
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => void handleRequestDecision(request.id, "rejected")}
                      disabled={reviewingRequestId !== null}
                      aria-label={`Reject ${request.requester_name}`}
                    >
                      <X className="h-4 w-4" />
                      <span className="ml-2">Reject</span>
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
            {requestActionError && <p role="alert" className="mt-3 text-sm text-rose">{requestActionError}</p>}
          </section>
        </div>
      )}
      {confirmSubmission && isAssignmentStudent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4">
          <section role="dialog" aria-modal="true" aria-labelledby="submit-assignment-title" className="w-full max-w-md rounded-xl border border-border bg-background p-6 shadow-2xl">
            <p className="text-xs font-semibold uppercase tracking-wide text-teal">Final check</p>
            <h2 id="submit-assignment-title" className="mt-2 text-lg font-semibold">Are you sure you want to submit this assignment?</h2>
            <div className="mt-4 space-y-2 rounded-lg border border-border bg-bg-surface p-4 text-sm">
              <p>Latest saved version: <span className="text-muted-foreground">Your current editor code will be saved before submitting.</span></p>
              <p>Attempts: <span className="text-muted-foreground">{assignmentProgress?.attempts ?? 0} previous submissions</span></p>
              <p>Deadline: <span className="text-muted-foreground">{room.assignment?.deadline ? new Date(room.assignment.deadline).toLocaleString() : "No deadline"}</span></p>
            </div>
            {assignmentNotice && <p role="alert" className="mt-3 text-sm text-rose">{assignmentNotice}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setConfirmSubmission(false)} disabled={assignmentBusy}>Cancel</Button>
              <Button type="button" onClick={() => void handleSubmitAssignment()} disabled={assignmentBusy}>
                {assignmentBusy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Submit Assignment
              </Button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
};

export default CollaborativeCoding;