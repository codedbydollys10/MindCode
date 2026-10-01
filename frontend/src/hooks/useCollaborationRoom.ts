import { useEffect, useState } from "react";
import * as Y from "yjs";
import { getSupabaseClient } from "@/lib/supabase";

export type CollaborationRoom = {
  id: string;
  publicId?: string;
  roomCode?: string;
  language: string;
  role: "owner" | "member" | "teacher";
  roomType?: "collaborative" | "teacher_assignment";
  teacherId?: string | null;
  assignment?: {
    room_id: string;
    room_name: string;
    title: string;
    teacher_name: string;
    instructions: string;
    deadline: string | null;
    created_at: string;
  } | null;
};

export type CollaborationParticipant = {
  id: string;
  name: string;
  role?: "owner" | "member" | "teacher";
  isSelf: boolean;
};

export type CollaborationStatus = "loading" | "pending" | "connecting" | "connected" | "reconnecting" | "error";

const API_BASE = import.meta.env.VITE_COLLABORATION_API_URL
  || import.meta.env.VITE_CODE_RUNNER_URL
  || (import.meta.env.DEV ? "http://localhost:3001" : "https://mindcode-4v9p.onrender.com");
const WEBSOCKET_URL = import.meta.env.VITE_COLLABORATION_WS_URL
  || `${API_BASE.replace(/^http/, "ws")}/collaboration`;

const decodeUpdate = (encoded: string) => Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
const encodeUpdate = (update: Uint8Array) => {
  let binary = "";
  for (const byte of update) binary += String.fromCharCode(byte);
  return btoa(binary);
};

const acceptTeacherInvite = async (roomId: string, inviteCode: string, headers: { Authorization: string }) => {
  const response = await fetch(`${API_BASE}/api/collaboration/rooms/${roomId}/teacher-invites/accept`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ inviteCode }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "Unable to accept this teacher invitation.");
  return body.room as CollaborationRoom;
};

const requestRoom = async (roomId: string, inviteCode: string | null, accessToken: string) => {
  const headers = { Authorization: `Bearer ${accessToken}` };
  let response = await fetch(`${API_BASE}/api/collaboration/rooms/${roomId}`, { headers });

  if (response.status === 403 && inviteCode) {
    response = await fetch(`${API_BASE}/api/collaboration/rooms/${roomId}/join`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ inviteCode }),
    });
  } else if (response.status === 403) {
    response = await fetch(`${API_BASE}/api/collaboration/rooms/${roomId}/requests`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
    });
    const requestBody = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(requestBody.error || "Unable to request access to this coding room.");
    if (requestBody.status === "pending" || requestBody.status === "accepted") return null;
    response = await fetch(`${API_BASE}/api/collaboration/rooms/${roomId}`, { headers });
  }

  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "Unable to open this coding room.");
  return body.room as CollaborationRoom;
};

export const useCollaborationRoom = (
  roomId: string | undefined,
  userId: string | undefined,
  inviteCode: string | null,
  teacherInviteCode: string | null,
) => {
  const [room, setRoom] = useState<CollaborationRoom | null>(null);
  const [document, setDocument] = useState<Y.Doc | null>(null);
  const [participants, setParticipants] = useState<CollaborationParticipant[]>([]);
  const [status, setStatus] = useState<CollaborationStatus>(roomId ? "loading" : "error");
  const [error, setError] = useState<string | null>(roomId ? null : "No coding room was selected.");

  useEffect(() => {
    if (!roomId || !userId) return;
    setRoom(null);
    setDocument(null);
    setParticipants([]);
    setStatus("loading");
    setError(null);
    let disposed = false;
    let socket: WebSocket | null = null;
    let retryTimer: number | null = null;
    let retryCount = 0;
    let socketAuthenticated = false;
    let ydoc: Y.Doc | null = null;

    const connect = async () => {
      if (disposed || !ydoc) return;
      setStatus(retryCount ? "reconnecting" : "connecting");

      try {
        const { data, error: sessionError } = await getSupabaseClient().auth.getSession();
        const accessToken = data.session?.access_token;
        if (sessionError || !accessToken) throw new Error("Your sign-in session has expired. Please sign in again.");

        socket = new WebSocket(WEBSOCKET_URL);
        socket.onopen = () => {
          socket?.send(JSON.stringify({ type: "authenticate", roomId, accessToken }));
        };
        socket.onmessage = (event) => {
          try {
            const message = JSON.parse(String(event.data));
            if (message.type === "sync" && typeof message.update === "string") {
              Y.applyUpdate(ydoc!, decodeUpdate(message.update), "remote");
              socketAuthenticated = true;
              socket?.send(JSON.stringify({
                type: "update",
                update: encodeUpdate(Y.encodeStateAsUpdate(ydoc!)),
              }));
              retryCount = 0;
              setError(null);
              setStatus("connected");
            } else if (message.type === "update" && typeof message.update === "string") {
              Y.applyUpdate(ydoc!, decodeUpdate(message.update), "remote");
            } else if (message.type === "participants" && Array.isArray(message.participants)) {
              setParticipants(message.participants);
            }
          } catch {
            setError("The room sent an invalid synchronization message.");
          }
        };
        socket.onclose = (event) => {
          socketAuthenticated = false;
          setParticipants([]);
          if (disposed) return;
          if ([4401, 4403, 4404].includes(event.code)) {
            setStatus("error");
            setError(event.code === 4403
              ? "You are not a member of this coding room."
              : event.code === 4404
                ? "This coding room no longer exists."
                : "Your sign-in session is invalid. Please sign in again.");
            return;
          }
          retryCount += 1;
          setStatus("reconnecting");
          setError("Connection interrupted. Reconnecting to the room...");
          const delay = Math.min(1000 * 2 ** Math.min(retryCount - 1, 4), 15_000);
          retryTimer = window.setTimeout(() => void connect(), delay);
        };
        socket.onerror = () => socket?.close();
      } catch (connectionError) {
        if (disposed) return;
        setStatus("error");
        setError(connectionError instanceof Error ? connectionError.message : "Unable to connect to this room.");
      }
    };

    const initialize = async () => {
      try {
        const { data, error: sessionError } = await getSupabaseClient().auth.getSession();
        const accessToken = data.session?.access_token;
        if (sessionError || !accessToken) throw new Error("Sign in to open a coding room.");
        let roomDetails: CollaborationRoom | null;
        if (teacherInviteCode) {
          const headers = { Authorization: `Bearer ${accessToken}` };
          const existingRoomResponse = await fetch(`${API_BASE}/api/collaboration/rooms/${roomId}`, { headers });
          if (existingRoomResponse.ok) {
            const existingRoom = (await existingRoomResponse.json()).room as CollaborationRoom;
            if (existingRoom.role === "teacher" || existingRoom.role === "owner") {
              roomDetails = existingRoom;
            } else {
              roomDetails = await acceptTeacherInvite(roomId, teacherInviteCode, headers);
            }
          } else if (existingRoomResponse.status === 403) {
            roomDetails = await acceptTeacherInvite(roomId, teacherInviteCode, headers);
          } else {
            const body = await existingRoomResponse.json().catch(() => ({}));
            throw new Error(body.error || "Unable to open this teacher invitation.");
          }
        } else {
          roomDetails = await requestRoom(roomId, inviteCode, accessToken);
        }
        if (!roomDetails) {
          setStatus("pending");
          setError("Access request sent. Waiting for the room owner to respond.");
          while (!disposed) {
            await new Promise((resolve) => window.setTimeout(resolve, 2000));
            const { data: refreshedSession, error: refreshError } = await getSupabaseClient().auth.getSession();
            const refreshedToken = refreshedSession.session?.access_token;
            if (refreshError || !refreshedToken) throw new Error("Your sign-in session has expired. Please sign in again.");
            const requestResponse = await fetch(`${API_BASE}/api/collaboration/rooms/${roomId}/request`, {
              headers: { Authorization: `Bearer ${refreshedToken}` },
            });
            const requestBody = await requestResponse.json().catch(() => ({}));
            if (!requestResponse.ok) throw new Error(requestBody.error || "Unable to check the room access request.");
            if (requestBody.status === "rejected") throw new Error("The room owner declined your access request.");
            if (requestBody.status === "accepted") {
              const roomResponse = await fetch(`${API_BASE}/api/collaboration/rooms/${roomId}`, {
                headers: { Authorization: `Bearer ${refreshedToken}` },
              });
              const roomBody = await roomResponse.json().catch(() => ({}));
              if (roomResponse.status === 403) continue;
              if (!roomResponse.ok) throw new Error(roomBody.error || "Unable to open this coding room.");
              roomDetails = roomBody.room as CollaborationRoom;
              setStatus("loading");
              setError(null);
              break;
            }
          }
        }
        if (disposed || !roomDetails) return;
        if (disposed) return;
        const nextDocument = new Y.Doc();
        ydoc = nextDocument;
        setRoom(roomDetails);
        setDocument(nextDocument);
        nextDocument.on("update", (update, origin) => {
          if (origin === "remote" || !socketAuthenticated || socket?.readyState !== WebSocket.OPEN) return;
          socket.send(JSON.stringify({ type: "update", update: encodeUpdate(update) }));
        });
        await connect();
      } catch (initializationError) {
        if (disposed) return;
        setStatus("error");
        setError(initializationError instanceof Error ? initializationError.message : "Unable to open this coding room.");
      }
    };

    void initialize();
    return () => {
      disposed = true;
      socketAuthenticated = false;
      if (retryTimer !== null) window.clearTimeout(retryTimer);
      socket?.close(1000, "Room closed");
      ydoc?.destroy();
      setParticipants([]);
    };
  }, [roomId, userId, inviteCode, teacherInviteCode]);

  return { room, document, participants, status, error };
};