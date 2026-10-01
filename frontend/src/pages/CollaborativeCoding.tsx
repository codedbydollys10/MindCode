import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import Editor, { type OnMount } from "@monaco-editor/react";
import { MonacoBinding } from "y-monaco";
import { ArrowRight, Check, Copy, Loader2, Play, Users, Wifi, WifiOff } from "lucide-react";
import Navbar from "@/components/Navbar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSupabaseAuth } from "@/hooks/useSupabaseAuth";
import { useCollaborationRoom } from "@/hooks/useCollaborationRoom";
import { runCode } from "@/lib/codeRunner";
import { getSupabaseClient } from "@/lib/supabase";
import CodingMentorPanel, { type CodingMentorRun } from "@/components/CodingMentorPanel";

const languages = ["python", "javascript", "java", "cpp", "c", "go", "rust"] as const;
type SupportedLanguage = (typeof languages)[number];

const API_BASE = import.meta.env.VITE_COLLABORATION_API_URL
  || import.meta.env.VITE_CODE_RUNNER_URL
  || (import.meta.env.DEV ? "http://localhost:3001" : "https://mindcode-4v9p.onrender.com");
const MENTOR_API_BASE = import.meta.env.VITE_AI_API_BASE || API_BASE;

const CollaborativeCoding = () => {
  const { roomId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useSupabaseAuth();
  const inviteCode = searchParams.get("invite");
  const { room, document, participants, status, error } = useCollaborationRoom(roomId, user?.id, inviteCode);
  const [language, setLanguage] = useState<SupportedLanguage>("python");
  const [roomIdInput, setRoomIdInput] = useState("");
  const [inviteCodeInput, setInviteCodeInput] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [running, setRunning] = useState(false);
  const [stdin, setStdin] = useState("");
  const [output, setOutput] = useState("");
  const [runError, setRunError] = useState<string | null>(null);
  const [mentorRun, setMentorRun] = useState<CodingMentorRun | null>(null);
  const [copied, setCopied] = useState(false);
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const bindingRef = useRef<MonacoBinding | null>(null);
  const mentorRunIdRef = useRef(0);

  useEffect(() => {
    if (!document || !editorRef.current) return;
    const model = editorRef.current.getModel();
    if (!model) return;
    bindingRef.current?.destroy();
    bindingRef.current = new MonacoBinding(document.getText("code"), model, new Set([editorRef.current]));
    return () => {
      bindingRef.current?.destroy();
      bindingRef.current = null;
    };
  }, [document]);

  useEffect(() => {
    if (room && languages.includes(room.language as SupportedLanguage)) {
      setLanguage(room.language as SupportedLanguage);
    }
  }, [room]);

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
      navigate(`/collaborate/${body.room.id}?invite=${encodeURIComponent(body.inviteCode)}`);
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

  const handleRun = async () => {
    if (!document || !room) return;
    setRunning(true);
    setRunError(null);
    const code = document.getText("code").toString();
    const runId = ++mentorRunIdRef.current;
    if (!code.trim()) {
      const message = "Add code before running it.";
      setOutput(message);
      setMentorRun({ id: runId, language: room.language, code });
      setRunning(false);
      return;
    }
    setOutput("Running shared code...");
    try {
      const result = await runCode({
        language: room.language as SupportedLanguage,
        code,
        stdin,
      });
      setOutput(result.output || result.error || result.status || "No output received.");
      if (result.error) setRunError(result.error);
      setMentorRun({
        id: runId,
        language: room.language,
        code,
        error: result.error,
        output: result.output,
        status: result.status,
        statusId: result.statusId,
      });
    } catch (executionError) {
      const message = executionError instanceof Error ? executionError.message : "Unable to run code.";
      setRunError(message);
      setOutput(message);
      setMentorRun({ id: runId, language: room.language, code, error: message, executionUnavailable: true });
    } finally {
      setRunning(false);
    }
  };

  const handleCopyInvite = async () => {
    if (!room) return;
    const link = new URL(`/collaborate/${room.id}`, window.location.origin);
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
    return (
      <div className="min-h-screen bg-background text-foreground">
        <Navbar />
        <main className="max-w-xl mx-auto px-4 pt-28 text-center">
          <h1 className="text-2xl font-semibold">Sign in to collaborate</h1>
          <p className="text-sm text-muted-foreground mt-2">Coding rooms are available to authenticated MindCode users.</p>
          <Button asChild className="mt-5"><Link to="/login">Sign in <ArrowRight className="w-4 h-4 ml-2" /></Link></Button>
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

          <div className="grid md:grid-cols-2 gap-8 border-y border-border py-8">
            <section className="space-y-4">
              <div>
                <h2 className="text-lg font-semibold">Create a room</h2>
                <p className="text-sm text-muted-foreground mt-1">Choose the language, then share the room invitation.</p>
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
              <Button onClick={() => void handleCreateRoom()} disabled={creating}>
                {creating ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Users className="w-4 h-4 mr-2" />}
                Create coding room
              </Button>
            </section>

            <section className="space-y-4">
              <div>
                <h2 className="text-lg font-semibold">Open a room</h2>
                <p className="text-sm text-muted-foreground mt-1">Room members can reopen a room by ID; new members also need an invite code.</p>
              </div>
              <form onSubmit={handleOpenRoom} className="space-y-3">
                <Input
                  aria-label="Room ID"
                  placeholder="Room ID"
                  value={roomIdInput}
                  onChange={(event) => setRoomIdInput(event.target.value)}
                />
                <Input
                  aria-label="Invite code"
                  placeholder="Invite code (for new members)"
                  value={inviteCodeInput}
                  onChange={(event) => setInviteCodeInput(event.target.value)}
                />
                <Button type="submit" variant="outline">Open room <ArrowRight className="w-4 h-4 ml-2" /></Button>
              </form>
            </section>
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
        ? "Unavailable"
        : status === "loading"
          ? "Loading room"
          : "Connecting";

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Navbar />
      <main className="max-w-[1600px] mx-auto px-4 pt-20 pb-8">
        <div className="flex flex-wrap items-center justify-between gap-3 py-3 border-b border-border">
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">Collaborative coding room</p>
            <h1 className="font-mono text-sm sm:text-base truncate">{room?.id || roomId}</h1>
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

        {(error || formError) && <p role="alert" className="py-2 text-sm text-rose">{error || formError}</p>}

        <div className="grid lg:grid-cols-[minmax(0,1fr)_250px] gap-4 pt-4">
          <section className="min-w-0 border border-border rounded-card overflow-hidden">
            <div className="h-10 px-3 flex items-center justify-between bg-bg-surface border-b border-border">
              <span className="text-xs uppercase text-muted-foreground">{room?.language || language}</span>
              <Button type="button" size="sm" onClick={() => void handleRun()} disabled={!room || status !== "connected" || running}>
                {running ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Play className="w-4 h-4 mr-2" />}
                Run code
              </Button>
            </div>
            <div className="h-[55vh] min-h-[360px] max-h-[720px]">
              {document && (
                <Editor
                  height="100%"
                  language={room?.language || language}
                  onMount={(editor) => { editorRef.current = editor; }}
                  theme="vs-dark"
                  options={{
                    automaticLayout: true,
                    fontFamily: "JetBrains Mono, monospace",
                    fontSize: 14,
                    minimap: { enabled: false },
                    padding: { top: 12 },
                    readOnly: status !== "connected",
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
              {runError && <p className="text-xs text-rose">{runError}</p>}
              {room && <CodingMentorPanel key={room.id} apiBase={MENTOR_API_BASE} roomId={room.id} run={mentorRun} />}
            </div>
          </section>

          <aside className="border-t lg:border-t-0 lg:border-l border-border lg:pl-4 pt-4 lg:pt-0">
            <h2 className="flex items-center gap-2 text-sm font-semibold"><Users className="w-4 h-4 text-teal" /> Participants <span className="text-xs text-muted-foreground">{participants.length}</span></h2>
            <ul className="mt-3 space-y-2">
              {participants.map((participant) => (
                <li key={participant.id} className="flex items-center gap-2 text-sm">
                  <span className="w-2 h-2 rounded-full bg-teal shrink-0" />
                  <span className="truncate">{participant.name}</span>
                  {participant.isSelf && <span className="text-xs text-muted-foreground">you</span>}
                </li>
              ))}
              {participants.length === 0 && <li className="text-xs text-muted-foreground">Waiting for room connection…</li>}
            </ul>
            <p className="mt-5 text-xs text-muted-foreground">Edits sync live while connected. The latest room state is saved automatically.</p>
          </aside>
        </div>
      </main>
    </div>
  );
};

export default CollaborativeCoding;