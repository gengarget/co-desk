import type { Encouragement, LeaderboardEntry, Room, RoomMessage, Stats, Task, User } from "./types";

const SERVER_BASE_KEY = "codesk_server_base";

export const DEFAULT_API_BASE = import.meta.env.VITE_API_BASE || "http://127.0.0.1:8124";

export function normalizeApiBase(value: string) {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) return DEFAULT_API_BASE;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

export function getApiBase() {
  const stored = localStorage.getItem(SERVER_BASE_KEY);
  return stored ? normalizeApiBase(stored) : normalizeApiBase(DEFAULT_API_BASE);
}

export function getWsBase() {
  const explicit = import.meta.env.VITE_WS_BASE;
  if (explicit && !localStorage.getItem(SERVER_BASE_KEY)) {
    return explicit.replace(/\/+$/, "");
  }
  return getApiBase().replace(/^http:/i, "ws:").replace(/^https:/i, "wss:");
}

export function setApiBase(value: string) {
  localStorage.setItem(SERVER_BASE_KEY, normalizeApiBase(value));
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${getApiBase()}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(options?.headers ?? {})
    },
    ...options
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Request failed: ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export function createSession(displayName?: string) {
  return request<{ user: User }>("/api/session", {
    method: "POST",
    body: JSON.stringify({ display_name: displayName })
  });
}

export function registerUser(payload: {
  username: string;
  password: string;
  display_name?: string;
}) {
  return request<{ user: User }>("/api/auth/register", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function loginUser(payload: {
  username: string;
  password: string;
}) {
  return request<{ user: User }>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function listRooms() {
  return request<Room[]>("/api/rooms");
}

export function createRoom(name: string, description = "") {
  return request<Room>("/api/rooms", {
    method: "POST",
    body: JSON.stringify({ name, description })
  });
}

export function updateRoom(roomId: string, payload: {
  name?: string;
  description?: string;
}) {
  return request<Room>(`/api/rooms/${encodeURIComponent(roomId)}`, {
    method: "PATCH",
    body: JSON.stringify(payload)
  });
}

export function deleteRoom(roomId: string) {
  return request<{ ok: boolean }>(`/api/rooms/${encodeURIComponent(roomId)}`, {
    method: "DELETE"
  });
}

export function listTasks(userId: string) {
  return request<Task[]>(`/api/users/${encodeURIComponent(userId)}/tasks`);
}

export function createTask(userId: string, title: string) {
  return request<Task>(`/api/users/${encodeURIComponent(userId)}/tasks`, {
    method: "POST",
    body: JSON.stringify({ title })
  });
}

export function updateTask(taskId: string, payload: Partial<Pick<Task, "title" | "done">>) {
  return request<Task>(`/api/tasks/${encodeURIComponent(taskId)}`, {
    method: "PATCH",
    body: JSON.stringify(payload)
  });
}

export function deleteTask(taskId: string) {
  return request<{ ok: boolean }>(`/api/tasks/${encodeURIComponent(taskId)}`, {
    method: "DELETE"
  });
}

export function saveFocusSession(payload: {
  user_id: string;
  room_id?: string;
  task_title: string;
  duration_minutes: number;
}) {
  return request<{
    id: string;
    user_id: string;
    room_id: string | null;
    task_title: string;
    duration_minutes: number;
    completed_at: string;
  }>("/api/focus-sessions", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function getStats(userId: string) {
  return request<Stats>(`/api/users/${encodeURIComponent(userId)}/stats`);
}

export function getLeaderboard(limit = 10) {
  return request<LeaderboardEntry[]>(`/api/leaderboard?limit=${limit}`);
}

export function listRoomMessages(roomId: string, limit = 80) {
  return request<RoomMessage[]>(`/api/rooms/${encodeURIComponent(roomId)}/messages?limit=${limit}`);
}

export function sendRoomMessage(roomId: string, payload: {
  user_id: string;
  sender_name: string;
  message: string;
}) {
  return request<RoomMessage>(`/api/rooms/${encodeURIComponent(roomId)}/messages`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function deleteRoomMessage(roomId: string, messageId: string, userId: string) {
  return request<{ ok: boolean }>(
    `/api/rooms/${encodeURIComponent(roomId)}/messages/${encodeURIComponent(messageId)}/delete`,
    {
      method: "POST",
      body: JSON.stringify({ user_id: userId })
    }
  );
}

export function sendEncouragement(roomId: string, payload: {
  user_id: string;
  sender_name: string;
  message: string;
}) {
  return request<Encouragement>(`/api/rooms/${encodeURIComponent(roomId)}/encouragements`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}
