import { useCallback, useEffect, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { ArrowRight, Clipboard, GraduationCap, Loader2, Plus, Users } from "lucide-react";
import Navbar from "@/components/Navbar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useSupabaseAuth } from "@/hooks/useSupabaseAuth";
import { getSupabaseClient } from "@/lib/supabase";

const API_BASE = import.meta.env.VITE_COLLABORATION_API_URL
  || import.meta.env.VITE_CODE_RUNNER_URL
  || (import.meta.env.DEV ? "http://localhost:3001" : "https://mindcode-4v9p.onrender.com");
const languages = ["python", "javascript", "java", "cpp", "c", "go", "rust"] as const;
type SupportedLanguage = (typeof languages)[number];
type AssignmentSummary = {
  room_id: string;
  room_name: string;
  title: string;
  teacher_name: string;
  instructions: string;
  deadline: string | null;
};
type MonitoringStudent = {
  userId: string;
  progress: { code_runs: number; attempts: number; errors: number; submission_status: string; submitted_at: string | null };
  savedAt: string | null;
  submissions: Array<{ id: string; attempt: number; submitted_at: string }>;
  executionHistory: Array<{ id: string; has_error: boolean; ran_at: string }>;
  feedbackRequests: Array<{ id: string; status: string; requested_at: string; message?: string }>;
};
type TeacherRoom = {
  id: string;
  roomCode: string;
  language: SupportedLanguage;
  assignment: AssignmentSummary;
  students: number;
  submitted: number;
  feedbackRequests: number;
  studentDetails: MonitoringStudent[];
};

const TeacherDashboard = () => {
  const { user, userRole, loading: authLoading } = useSupabaseAuth();
  const navigate = useNavigate();
  const [rooms, setRooms] = useState<TeacherRoom[]>([]);
  const [loadingRooms, setLoadingRooms] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [roomName, setRoomName] = useState("");
  const [title, setTitle] = useState("");
  const [instructions, setInstructions] = useState("");
  const [language, setLanguage] = useState<SupportedLanguage>("python");
  const [deadline, setDeadline] = useState("");
  const [copiedRoomId, setCopiedRoomId] = useState<string | null>(null);
  const userId = user?.id;

  const getToken = useCallback(async () => {
    const { data, error: sessionError } = await getSupabaseClient().auth.getSession();
    if (sessionError) throw sessionError;
    const token = data.session?.access_token;
    if (!token) throw new Error("Your sign-in session has expired. Please sign in again.");
    return token;
  }, []);

  const refreshRooms = useCallback(async () => {
    const token = await getToken();
    const response = await fetch(`${API_BASE}/api/collaboration/assignments`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || "Unable to load your assignment rooms.");
    const assignmentRooms = body.assignments || [];
    const roomsWithStats = await Promise.all(assignmentRooms.map(async (item: Omit<TeacherRoom, "students" | "submitted" | "feedbackRequests" | "studentDetails">) => {
      const monitoringResponse = await fetch(`${API_BASE}/api/collaboration/assignments/${encodeURIComponent(item.id)}/monitoring`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const monitoringBody = await monitoringResponse.json().catch(() => ({}));
      if (!monitoringResponse.ok) throw new Error(monitoringBody.error || `Unable to load progress for ${item.assignment.title}.`);
      const students = monitoringBody.students || [];
      return {
        ...item,
        students: students.length,
        submitted: students.filter((student: { progress: { submission_status: string } }) => student.progress.submission_status === "Submitted").length,
        feedbackRequests: students.reduce((total: number, student: { feedbackRequests: Array<{ status: string }> }) =>
          total + student.feedbackRequests.filter((request) => request.status === "pending").length, 0),
        studentDetails: students as MonitoringStudent[],
      } satisfies TeacherRoom;
    }));
    setRooms(roomsWithStats);
  }, [getToken]);

  useEffect(() => {
    if (!userId || userRole !== "teacher") {
      setLoadingRooms(false);
      return;
    }
    let active = true;
    const load = async () => {
      setLoadingRooms(true);
      setError(null);
      try {
        await refreshRooms();
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : "Unable to load your assignment rooms.");
      } finally {
        if (active) setLoadingRooms(false);
      }
    };
    void load();
    return () => { active = false; };
  }, [userId, userRole, refreshRooms]);

  const handleCreateRoom = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setCreateBusy(true);
    setError(null);
    try {
      const token = await getToken();
      const response = await fetch(`${API_BASE}/api/collaboration/assignments`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          roomName: roomName.trim(),
          title: title.trim(),
          instructions: instructions.trim(),
          language,
          deadline: deadline ? new Date(deadline).toISOString() : null,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Unable to create the assignment room.");
      setCreateOpen(false);
      navigate(`/collaborate/${encodeURIComponent(body.room.publicId || body.room.id)}`);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Unable to create the assignment room.");
    } finally {
      setCreateBusy(false);
    }
  };

  const handleCopyLink = async (room: TeacherRoom) => {
    const link = new URL(`/join/${encodeURIComponent(room.roomCode)}`, window.location.origin);
    try {
      await navigator.clipboard.writeText(link.toString());
      setCopiedRoomId(room.id);
      window.setTimeout(() => setCopiedRoomId(null), 1800);
    } catch {
      setError("Unable to copy the assignment link in this browser.");
    }
  };

  if (authLoading) {
    return <div className="flex min-h-screen items-center justify-center bg-background"><Loader2 className="h-5 w-5 animate-spin text-teal" /></div>;
  }
  if (!user) {
    return <Navigate to={`/login?redirect=${encodeURIComponent("/teacher/dashboard")}`} replace />;
  }
  if (userRole !== "teacher") {
    return <Navigate to="/collaborate" replace />;
  }

  const studentCount = rooms.reduce((total, room) => total + room.students, 0);
  const submissionCount = rooms.reduce((total, room) => total + room.submitted, 0);
  const feedbackCount = rooms.reduce((total, room) => total + room.feedbackRequests, 0);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Navbar />
      <main className="mx-auto max-w-6xl px-4 pb-12 pt-24">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-teal"><GraduationCap className="h-4 w-4" /> Teacher workspace</p>
            <h1 className="mt-2 text-3xl font-bold">Teacher Dashboard</h1>
            <p className="mt-2 text-sm text-muted-foreground">Create assignments, review private student work, and send feedback.</p>
          </div>
          <Button onClick={() => { setError(null); setCreateOpen(true); }}><Plus className="mr-2 h-4 w-4" />Create Assignment Room</Button>
        </header>

        {error && <p role="alert" className="mt-5 rounded-lg border border-rose/30 bg-rose/5 p-3 text-sm text-rose">{error}</p>}

        <section className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-label="Assignment overview">
          {[
            { label: "My Assignment Rooms", value: rooms.length },
            { label: "Students", value: studentCount },
            { label: "Feedback Requests", value: feedbackCount },
            { label: "Submissions", value: submissionCount },
          ].map((stat) => (
            <article key={stat.label} className="rounded-xl border border-border bg-card/70 p-5">
              <p className="text-xs text-muted-foreground">{stat.label}</p>
              <p className="mt-2 text-2xl font-semibold">{loadingRooms ? "—" : stat.value}</p>
            </article>
          ))}
        </section>

        <section className="mt-9">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-xl font-semibold">My Assignment Rooms</h2>
            <Link to="/collaborate" className="inline-flex items-center gap-1 text-sm text-teal hover:underline">Collaborative rooms <ArrowRight className="h-4 w-4" /></Link>
          </div>
          {loadingRooms ? (
            <div className="mt-6 flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading assignment rooms…</div>
          ) : rooms.length === 0 ? (
            <div className="mt-5 rounded-xl border border-dashed border-border p-8 text-center">
              <Users className="mx-auto h-8 w-8 text-muted-foreground" />
              <p className="mt-3 font-medium">No assignment rooms yet</p>
              <p className="mt-1 text-sm text-muted-foreground">Create an assignment room and share its join link with your students.</p>
            </div>
          ) : (
            <div className="mt-5 grid gap-4 lg:grid-cols-2">
              {rooms.map((room) => (
                <article key={room.id} className="rounded-xl border border-border bg-card/70 p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold uppercase tracking-wide text-teal">{room.assignment.room_name}</p>
                      <h3 className="mt-1 truncate text-lg font-semibold">{room.assignment.title}</h3>
                      <p className="mt-1 text-xs text-muted-foreground">{room.assignment.deadline ? `Due ${new Date(room.assignment.deadline).toLocaleString()}` : "No deadline"} · {room.language}</p>
                    </div>
                    <span className="rounded-md border border-border px-2 py-1 font-mono text-xs">{room.roomCode}</span>
                  </div>
                  <dl className="mt-5 grid grid-cols-3 gap-2 border-y border-border py-3 text-xs">
                    <div><dt className="text-muted-foreground">Students</dt><dd className="mt-1 font-semibold">{room.students}</dd></div>
                    <div><dt className="text-muted-foreground">Submitted</dt><dd className="mt-1 font-semibold">{room.submitted}</dd></div>
                    <div><dt className="text-muted-foreground">Feedback requests</dt><dd className="mt-1 font-semibold">{room.feedbackRequests}</dd></div>
                  </dl>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button size="sm" onClick={() => navigate(`/collaborate/${encodeURIComponent(room.roomCode)}`)}>Monitor Students</Button>
                    <Button size="sm" variant="outline" onClick={() => void handleCopyLink(room)}>
                      <Clipboard className="mr-2 h-4 w-4" />{copiedRoomId === room.id ? "Copied" : "Copy Join Link"}
                    </Button>
                  </div>
                  <details className="mt-4 border-t border-border pt-3">
                    <summary className="cursor-pointer text-sm font-medium">Student progress and feedback requests</summary>
                    <ul className="mt-3 space-y-3">
                      {room.studentDetails.map((student) => (
                        <li key={student.userId} className="rounded-lg border border-border p-3 text-xs">
                          <p className="break-all font-medium">{student.userId}</p>
                          <p className="mt-1 text-muted-foreground">
                            {student.progress.code_runs} runs · {student.progress.attempts} attempts · {student.progress.errors} errors · {student.progress.submission_status}
                          </p>
                          {student.submissions.length > 0 && (
                            <p className="mt-1 text-muted-foreground">
                              Latest submission: attempt {student.submissions[0].attempt} · {new Date(student.submissions[0].submitted_at).toLocaleString()}
                            </p>
                          )}
                          {student.feedbackRequests.map((request) => (
                            <p key={request.id} className={`mt-2 ${request.status === "pending" ? "text-amber-300" : "text-muted-foreground"}`}>
                              {request.status === "pending" ? "Feedback requested" : "Request fulfilled"}
                              {request.message ? `: ${request.message}` : ""}
                            </p>
                          ))}
                        </li>
                      ))}
                      {room.studentDetails.length === 0 && <li className="text-xs text-muted-foreground">No students have joined this assignment yet.</li>}
                    </ul>
                  </details>
                </article>
              ))}
            </div>
          )}
        </section>
      </main>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Create Assignment Room</DialogTitle>
            <DialogDescription>Share the generated code or link with your students after the room is created.</DialogDescription>
          </DialogHeader>
          <form onSubmit={(event) => void handleCreateRoom(event)} className="space-y-4">
            <div>
              <label className="block text-sm font-medium" htmlFor="teacher-room-name">Room / class name</label>
              <Input id="teacher-room-name" required maxLength={120} className="mt-2" value={roomName} onChange={(event) => setRoomName(event.target.value)} placeholder="e.g. CS 101 · Period 2" />
            </div>
            <div>
              <label className="block text-sm font-medium" htmlFor="teacher-assignment-title">Assignment title</label>
              <Input id="teacher-assignment-title" required maxLength={120} className="mt-2" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="e.g. Python loops practice" />
            </div>
            <div>
              <label className="block text-sm font-medium" htmlFor="teacher-assignment-instructions">Instructions</label>
              <textarea id="teacher-assignment-instructions" maxLength={10000} className="mt-2 min-h-28 w-full rounded-md border border-input bg-background p-3 text-sm" value={instructions} onChange={(event) => setInstructions(event.target.value)} placeholder="Describe the work students should complete." />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-sm font-medium" htmlFor="teacher-assignment-language">Programming language</label>
                <select id="teacher-assignment-language" value={language} onChange={(event) => setLanguage(event.target.value as SupportedLanguage)} className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm uppercase">
                  {languages.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium" htmlFor="teacher-assignment-deadline">Deadline (optional)</label>
                <Input id="teacher-assignment-deadline" type="datetime-local" className="mt-2" value={deadline} onChange={(event) => setDeadline(event.target.value)} />
              </div>
            </div>
            {error && <p role="alert" className="text-sm text-rose">{error}</p>}
            <Button type="submit" disabled={createBusy || !roomName.trim() || !title.trim()} className="w-full">
              {createBusy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Create Assignment Room
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default TeacherDashboard;
