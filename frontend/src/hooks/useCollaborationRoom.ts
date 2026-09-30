import { useEffect, useState } from "react";
import * as Y from "yjs";
import { getSupabaseClient } from "@/lib/supabase";

export type CollaborationRoom = {
  id: string;
  language: string;
  role: "owner" | "member";
};

export type CollaborationParticipant = {
  id: string;
  name: string;
  isSelf: boolean;
};

export type CollaborationStatus = "loading" | "connecting" | "connected" | "reconnecting" | "error";

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

const requestRoom = async (roomId: string, inviteCode: string | null, accessToken: string) => {
  const headers = { Authorization: `Bearer ${accessToken}` };
  let response = await fetch(`${API_BASE}/api/collaboration/rooms/${roomId}`, { headers });

  if (response.status === 403 && inviteCode) {
    response = await fetch(`${API_BASE}/api/collaboration/rooms/${roomId}/join`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ inviteCode }),
    });
  }

  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "Unable to open this coding room.");
  return body.room as CollaborationRoom;
};

export const useCollaborationRoom = (roomId: string | undefined, userId: string | undefined, inviteCode: string | null) => {
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
        const roomDetails = await requestRoom(roomId, inviteCode, accessToken);
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
  }, [roomId, userId, inviteCode]);

  return { room, document, participants, status, error };
};