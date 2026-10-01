import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import Editor, { type OnMount } from "@monaco-editor/react";
import { MonacoBinding } from "y-monaco";
import { ArrowRight, Check, Copy, Loader2, Play, Sparkles, Users, Wifi, WifiOff, X } from "lucide-react";
import Navbar from "@/components/Navbar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSupabaseAuth } from "@/hooks/useSupabaseAuth";
import { useCollaborationRoom } from "@/hooks/useCollaborationRoom";
import { runCode } from "@/lib/codeRunner";
import { getSupabaseClient } from "@/lib/supabase";

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
  const { user, loading: authLoading } = useSupabaseAuth();
  const inviteCode = searchParams.get("invite");
  const teacherInviteCode = searchParams.get("teacherInvite");
  const { room, document, participants, status, error } = useCollaborationRoom(roomId, user?.id, inviteCode, teacherInviteCode);
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

  const ownedRoomId = room?.role === "owner" ? room.id : null;

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
    } finally {
      setRunning(false);
    }
  };

  const handleCopyInvite = async () => {
    const publicRoomId = room?.publicId || room?.roomCode || room?.id || roomId || "";
    if (!publicRoomId) {
      setFormError("This room is not ready yet. Please wait for it to load.");
      return;
    }

    const link = new URL(`/collaborate/${encodeURIComponent(publicRoomId)}`, window.location.origin);
    if (inviteCode) link.searchParams.set("invite", inviteCode);

    try {
      await navigator.clipboard.writeText(link.toString());
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setFormError("Unable to copy the invitation link in this browser.");
    }
  };

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
        <main className="max-w-5xl mx-auto px-4 pt-24 pb-12 space-y-8">
          <header>
            <p className="text-sm text-teal flex items-center gap-2"><Users className="w-4 h-4" /> MindCode workspace</p>
            <h1 className="text-3xl font-bold mt-2">Collaborative Coding</h1>
            <p className="text-sm text-muted-foreground mt-2">Create a shared room or open an invitation from another participant.</p>
          </header>

          <div className="border-y border-border py-8">
            <section className="max-w-xl space-y-4">
              <div>
                <h2 className="text-lg font-semibold">Create a shared coding session</h2>
                <p className="text-sm text-muted-foreground mt-1">Choose a language and immediately enter a live collaborative room.</p>
              </div>

              <label className="block text-sm text-muted-foreground" htmlFor="new-room-language">Language</label>
              <select
                id="new-room-language"
                className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm uppercase"
                value={language}
                onChange={(event) => setLanguage(event.target.value as SupportedLanguage)}
              >
                {languages.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>

              <Button onClick={() => void handleCreateRoom()} disabled={creating} className="w-full sm:w-auto">
                {creating ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Users className="w-4 h-4 mr-2" />}
                Create Collaborative Room
              </Button>
            </section>

            <div className="mt-8 max-w-xl border-t border-border pt-6">
              <p className="text-sm text-muted-foreground">Have a room code?</p>
              <form onSubmit={handleOpenRoom} className="mt-3 space-y-3">
                <Input
                  aria-label="Room ID"
                  placeholder="Enter room code or room ID"
                  value={roomIdInput}
                  onChange={(event) => setRoomIdInput(event.target.value)}
                />
                <Input
                  aria-label="Invite code"
                  placeholder="Optional invite code"
                  value={inviteCodeInput}
                  onChange={(event) => setInviteCodeInput(event.target.value)}
                />
                <Button type="submit" variant="outline">Open room <ArrowRight className="w-4 h-4 ml-2" /></Button>
              </form>
            </div>
          </div>
          {formError && <p role="alert" className="text-sm text-rose">{formError}</p>}
        </main>
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
            <p className="text-xs text-muted-foreground">Collaborative coding room</p>
            <h1 className="font-mono text-sm sm:text-base truncate">{room?.publicId || room?.roomCode || room?.id || roomId}</h1>
            {room?.role === "teacher" && <p className="mt-1 text-xs font-medium text-teal">Teacher Mode · Read-only review</p>}
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground" role="status">
              {status === "connected" ? <Wifi className="w-3.5 h-3.5 text-teal" /> : <WifiOff className="w-3.5 h-3.5" />}
              {statusText}
            </span>
            <Button type="button" variant="outline" size="sm" onClick={() => void handleCopyInvite()} disabled={!room}>
              {copied ? <Check className="w-4 h-4 mr-2" /> : <Copy className="w-4 h-4 mr-2" />}
              {copied ? "Copied" : "Copy invite"}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => navigate("/collaborate")}>Leave room</Button>
          </div>
        </div>

        {room?.role === "owner" && (
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
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void handleSuggestCorrection()}
                  disabled={!room || status !== "connected" || (!execution?.error && !selectedError) || correctionLoading}
                >
                  {correctionLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                  Ask AI for assistance
                </Button>
                <Button type="button" size="sm" onClick={() => void handleRun()} disabled={!room || status !== "connected" || running || room.role === "teacher"}>
                  {running ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Play className="w-4 h-4 mr-2" />}
                  {room?.role === "teacher" ? "Student Run Output" : "Run code"}
                </Button>
              </div>
            </div>
            <div className="h-[55vh] min-h-[360px] max-h-[720px]">
              {document && (
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
            <div className="border-t border-border bg-bg-surface p-3 space-y-2">
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
            </div>
          </section>

          <aside className="border-t lg:border-t-0 lg:border-l border-border lg:pl-4 pt-4 lg:pt-0">
            <h2 className="flex items-center gap-2 text-sm font-semibold"><Users className="w-4 h-4 text-teal" /> Participants <span className="text-xs text-muted-foreground">{participants.length}</span></h2>
            <ul className="mt-3 space-y-2">
              {participants.map((participant) => (
                <li key={participant.id} className="flex items-center gap-2 text-sm">
                  <span className="w-2 h-2 rounded-full bg-teal shrink-0" />
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
          </aside>
        </div>
      </main>
      {room?.role === "owner" && pendingRequests.length > 0 && (
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
    </div>
  );
};

export default CollaborativeCoding;