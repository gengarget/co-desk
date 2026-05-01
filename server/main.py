from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import os
import re
import secrets
import sqlite3
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import uvicorn
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field


ROOT_DIR = Path(__file__).resolve().parents[1]
DATA_DIR = Path(os.environ.get("CODESK_DATA_DIR", ROOT_DIR / "data"))
DB_PATH = Path(os.environ.get("CODESK_DB_PATH", DATA_DIR / "codesk.sqlite"))
SERVER_HOST = os.environ.get("HOST", "127.0.0.1")
SERVER_PORT = int(os.environ.get("PORT", "8124"))
PASSWORD_ITERATIONS = 160_000
USERNAME_PATTERN = re.compile(r"^[a-zA-Z0-9_]{3,24}$")


def parse_cors_origins() -> list[str]:
  raw = os.environ.get("CODESK_CORS_ORIGINS")
  if raw:
    return [origin.strip() for origin in raw.split(",") if origin.strip()]
  return [
    "http://127.0.0.1:5173",
    "http://localhost:5173",
    "null",
  ]


def now_iso() -> str:
  return datetime.now(timezone.utc).isoformat()


def new_id(prefix: str) -> str:
  return f"{prefix}_{uuid.uuid4().hex[:12]}"


def normalize_username(username: str) -> str:
  return username.strip().lower()


def hash_password(password: str, salt: str) -> str:
  digest = hashlib.pbkdf2_hmac(
    "sha256",
    password.encode("utf-8"),
    salt.encode("utf-8"),
    PASSWORD_ITERATIONS,
  )
  return digest.hex()


def verify_password(password: str, salt: str, expected_hash: str) -> bool:
  actual_hash = hash_password(password, salt)
  return hmac.compare_digest(actual_hash, expected_hash)


def public_user(row: sqlite3.Row) -> dict[str, Any]:
  return {
    "id": row["id"],
    "username": row["username"] if "username" in row.keys() else None,
    "display_name": row["display_name"],
  }


def open_db() -> sqlite3.Connection:
  DATA_DIR.mkdir(parents=True, exist_ok=True)
  conn = sqlite3.connect(DB_PATH)
  conn.row_factory = sqlite3.Row
  return conn


def row_to_dict(row: sqlite3.Row) -> dict[str, Any]:
  return {key: row[key] for key in row.keys()}


def init_db() -> None:
  with open_db() as conn:
    conn.executescript(
      """
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE,
        display_name TEXT NOT NULL,
        password_hash TEXT,
        password_salt TEXT,
        last_login_at TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS rooms (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        title TEXT NOT NULL,
        done INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id)
      );

      CREATE TABLE IF NOT EXISTS focus_sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        room_id TEXT,
        task_title TEXT NOT NULL,
        duration_minutes INTEGER NOT NULL,
        completed_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (room_id) REFERENCES rooms(id)
      );

      CREATE TABLE IF NOT EXISTS encouragements (
        id TEXT PRIMARY KEY,
        room_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        sender_name TEXT NOT NULL,
        message TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (room_id) REFERENCES rooms(id),
        FOREIGN KEY (user_id) REFERENCES users(id)
      );
      """
    )
    existing_columns = {row["name"] for row in conn.execute("PRAGMA table_info(users)").fetchall()}
    for name, ddl in [
      ("username", "username TEXT"),
      ("password_hash", "password_hash TEXT"),
      ("password_salt", "password_salt TEXT"),
      ("last_login_at", "last_login_at TEXT"),
    ]:
      if name not in existing_columns:
        conn.execute(f"ALTER TABLE users ADD COLUMN {ddl}")
    seeds = [
      ("room_exam", "期末冲刺自习室", "适合课程复习、刷题和报告收尾。"),
      ("room_grad", "考研静音桌", "长时间深度学习，默认弱社交。"),
      ("room_paper", "论文写作房", "适合论文、报告、代码和项目文档。"),
    ]
    for room_id, name, description in seeds:
      conn.execute(
        """
        INSERT OR IGNORE INTO rooms (id, name, description, created_at)
        VALUES (?, ?, ?, ?)
        """,
        (room_id, name, description, now_iso()),
      )
    conn.commit()


class SessionCreate(BaseModel):
  display_name: str | None = Field(default=None, max_length=24)


class AuthRegister(BaseModel):
  username: str = Field(min_length=3, max_length=24)
  password: str = Field(min_length=6, max_length=72)
  display_name: str | None = Field(default=None, max_length=24)


class AuthLogin(BaseModel):
  username: str = Field(min_length=3, max_length=24)
  password: str = Field(min_length=6, max_length=72)


class RoomCreate(BaseModel):
  name: str = Field(min_length=1, max_length=32)
  description: str = Field(default="", max_length=120)


class RoomUpdate(BaseModel):
  name: str | None = Field(default=None, min_length=1, max_length=32)
  description: str | None = Field(default=None, max_length=120)


class TaskCreate(BaseModel):
  title: str = Field(min_length=1, max_length=80)


class TaskUpdate(BaseModel):
  title: str | None = Field(default=None, max_length=80)
  done: bool | None = None


class FocusSessionCreate(BaseModel):
  user_id: str
  room_id: str | None = None
  task_title: str = Field(default="自由专注", max_length=80)
  duration_minutes: int = Field(ge=1, le=240)


class EncouragementCreate(BaseModel):
  user_id: str
  sender_name: str = Field(max_length=24)
  message: str = Field(min_length=1, max_length=48)


@dataclass
class Peer:
  websocket: WebSocket
  user_id: str
  display_name: str
  seat: int
  status: str = "准备中"
  current_task: str = "自由专注"
  timer_label: str = "25:00"
  ambient: str = "图书馆底噪"
  joined_at: str = field(default_factory=now_iso)

  def public(self) -> dict[str, Any]:
    return {
      "user_id": self.user_id,
      "display_name": self.display_name,
      "seat": self.seat,
      "status": self.status,
      "current_task": self.current_task,
      "timer_label": self.timer_label,
      "ambient": self.ambient,
      "joined_at": self.joined_at,
    }


class RoomHub:
  def __init__(self) -> None:
    self.rooms: dict[str, dict[str, Peer]] = {}
    self.lock = asyncio.Lock()

  async def connect(self, room_id: str, websocket: WebSocket, user_id: str, display_name: str) -> Peer:
    await websocket.accept()
    async with self.lock:
      peers = self.rooms.setdefault(room_id, {})
      occupied = {peer.seat for peer in peers.values()}
      seat = next((n for n in range(1, 11) if n not in occupied), len(occupied) + 1)
      peer = Peer(websocket=websocket, user_id=user_id, display_name=display_name, seat=seat)
      peers[user_id] = peer
    await self.broadcast_state(room_id)
    return peer

  async def disconnect(self, room_id: str, user_id: str) -> None:
    async with self.lock:
      peers = self.rooms.get(room_id, {})
      peers.pop(user_id, None)
      if not peers and room_id in self.rooms:
        del self.rooms[room_id]
    await self.broadcast_state(room_id)

  async def update_peer(self, room_id: str, user_id: str, payload: dict[str, Any]) -> None:
    async with self.lock:
      peer = self.rooms.get(room_id, {}).get(user_id)
      if not peer:
        return
      peer.status = str(payload.get("status", peer.status))[:24]
      peer.current_task = str(payload.get("current_task", peer.current_task))[:80]
      peer.timer_label = str(payload.get("timer_label", peer.timer_label))[:12]
      peer.ambient = str(payload.get("ambient", peer.ambient))[:24]
    await self.broadcast_state(room_id)

  async def count(self, room_id: str) -> int:
    async with self.lock:
      return len(self.rooms.get(room_id, {}))

  async def counts(self) -> dict[str, int]:
    async with self.lock:
      return {room_id: len(peers) for room_id, peers in self.rooms.items()}

  async def broadcast_state(self, room_id: str) -> None:
    async with self.lock:
      peers = list(self.rooms.get(room_id, {}).values())
      payload = {
        "type": "room_state",
        "room_id": room_id,
        "online_count": len(peers),
        "peers": [peer.public() for peer in peers],
      }
    await self._send(room_id, payload)

  async def broadcast_encouragement(self, room_id: str, payload: dict[str, Any]) -> None:
    await self._send(room_id, {"type": "encouragement", **payload})

  async def close_room(self, room_id: str) -> None:
    async with self.lock:
      peers = list(self.rooms.pop(room_id, {}).values())
    for peer in peers:
      try:
        await peer.websocket.send_json({"type": "room_deleted", "room_id": room_id})
        await peer.websocket.close(code=4001)
      except Exception:
        pass

  async def _send(self, room_id: str, payload: dict[str, Any]) -> None:
    async with self.lock:
      peers = list(self.rooms.get(room_id, {}).values())
    stale: list[str] = []
    for peer in peers:
      try:
        await peer.websocket.send_json(payload)
      except Exception:
        stale.append(peer.user_id)
    if stale:
      async with self.lock:
        peers_map = self.rooms.get(room_id, {})
        for user_id in stale:
          peers_map.pop(user_id, None)


init_db()
hub = RoomHub()

app = FastAPI(title="Co-Desk API")
app.add_middleware(
  CORSMiddleware,
  allow_origins=parse_cors_origins(),
  allow_origin_regex=os.environ.get("CODESK_CORS_REGEX"),
  allow_credentials=False,
  allow_methods=["*"],
  allow_headers=["*"],
)


@app.get("/api/health")
async def health() -> dict[str, str]:
  return {"status": "ok", "database": str(DB_PATH)}


@app.post("/api/auth/register")
async def register(payload: AuthRegister) -> dict[str, Any]:
  username = normalize_username(payload.username)
  if not USERNAME_PATTERN.match(username):
    raise HTTPException(status_code=400, detail="用户名只能包含 3-24 位字母、数字或下划线")

  display_name = (payload.display_name or "").strip() or username
  salt = secrets.token_hex(16)
  password_hash = hash_password(payload.password, salt)
  user_id = new_id("user")
  stamp = now_iso()

  with open_db() as conn:
    exists = conn.execute("SELECT id FROM users WHERE username = ?", (username,)).fetchone()
    if exists:
      raise HTTPException(status_code=409, detail="这个用户名已经被注册")

    conn.execute(
      """
      INSERT INTO users (id, username, display_name, password_hash, password_salt, last_login_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      """,
      (user_id, username, display_name, password_hash, salt, stamp, stamp),
    )
    conn.commit()
    row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()

  return {"user": public_user(row)}


@app.post("/api/auth/login")
async def login(payload: AuthLogin) -> dict[str, Any]:
  username = normalize_username(payload.username)
  with open_db() as conn:
    row = conn.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()
    if not row or not row["password_hash"] or not row["password_salt"]:
      raise HTTPException(status_code=401, detail="用户名或密码错误")

    if not verify_password(payload.password, row["password_salt"], row["password_hash"]):
      raise HTTPException(status_code=401, detail="用户名或密码错误")

    conn.execute("UPDATE users SET last_login_at = ? WHERE id = ?", (now_iso(), row["id"]))
    conn.commit()
    row = conn.execute("SELECT * FROM users WHERE id = ?", (row["id"],)).fetchone()

  return {"user": public_user(row)}


@app.post("/api/session")
async def create_session(payload: SessionCreate) -> dict[str, Any]:
  display_name = (payload.display_name or "").strip()
  if not display_name:
    display_name = f"自习同学-{uuid.uuid4().hex[:4]}"
  user_id = new_id("user")
  with open_db() as conn:
    conn.execute(
      "INSERT INTO users (id, display_name, created_at) VALUES (?, ?, ?)",
      (user_id, display_name, now_iso()),
    )
    conn.commit()
  return {"user": {"id": user_id, "display_name": display_name}}


@app.get("/api/rooms")
async def list_rooms() -> list[dict[str, Any]]:
  counts = await hub.counts()
  with open_db() as conn:
    rows = conn.execute("SELECT * FROM rooms ORDER BY created_at ASC").fetchall()
  rooms = []
  for row in rows:
    item = row_to_dict(row)
    item["online_count"] = counts.get(item["id"], 0)
    rooms.append(item)
  return rooms


@app.post("/api/rooms")
async def create_room(payload: RoomCreate) -> dict[str, Any]:
  room_id = new_id("room")
  name = payload.name.strip()
  description = payload.description.strip()
  if not name:
    raise HTTPException(status_code=400, detail="Room name is required")
  with open_db() as conn:
    conn.execute(
      "INSERT INTO rooms (id, name, description, created_at) VALUES (?, ?, ?, ?)",
      (room_id, name, description, now_iso()),
    )
    conn.commit()
    row = conn.execute("SELECT * FROM rooms WHERE id = ?", (room_id,)).fetchone()
  item = row_to_dict(row)
  item["online_count"] = 0
  return item


@app.patch("/api/rooms/{room_id}")
async def update_room(room_id: str, payload: RoomUpdate) -> dict[str, Any]:
  with open_db() as conn:
    row = conn.execute("SELECT * FROM rooms WHERE id = ?", (room_id,)).fetchone()
    if not row:
      raise HTTPException(status_code=404, detail="Room not found")

    name = row["name"] if payload.name is None else payload.name.strip()
    description = row["description"] if payload.description is None else payload.description.strip()
    if not name:
      raise HTTPException(status_code=400, detail="Room name is required")

    conn.execute(
      "UPDATE rooms SET name = ?, description = ? WHERE id = ?",
      (name, description, room_id),
    )
    conn.commit()
    row = conn.execute("SELECT * FROM rooms WHERE id = ?", (room_id,)).fetchone()

  item = row_to_dict(row)
  item["online_count"] = await hub.count(room_id)
  await hub.broadcast_state(room_id)
  return item


@app.delete("/api/rooms/{room_id}")
async def delete_room(room_id: str) -> dict[str, bool]:
  with open_db() as conn:
    row = conn.execute("SELECT id FROM rooms WHERE id = ?", (room_id,)).fetchone()
    if not row:
      raise HTTPException(status_code=404, detail="Room not found")

    conn.execute("DELETE FROM encouragements WHERE room_id = ?", (room_id,))
    conn.execute("UPDATE focus_sessions SET room_id = NULL WHERE room_id = ?", (room_id,))
    conn.execute("DELETE FROM rooms WHERE id = ?", (room_id,))
    conn.commit()

  await hub.close_room(room_id)
  return {"ok": True}


@app.get("/api/users/{user_id}/tasks")
async def list_tasks(user_id: str) -> list[dict[str, Any]]:
  with open_db() as conn:
    rows = conn.execute(
      "SELECT * FROM tasks WHERE user_id = ? ORDER BY done ASC, created_at DESC",
      (user_id,),
    ).fetchall()
  return [{**row_to_dict(row), "done": bool(row["done"])} for row in rows]


@app.post("/api/users/{user_id}/tasks")
async def create_task(user_id: str, payload: TaskCreate) -> dict[str, Any]:
  title = payload.title.strip()
  if not title:
    raise HTTPException(status_code=400, detail="Task title is required")
  task_id = new_id("task")
  stamp = now_iso()
  with open_db() as conn:
    conn.execute(
      """
      INSERT INTO tasks (id, user_id, title, done, created_at, updated_at)
      VALUES (?, ?, ?, 0, ?, ?)
      """,
      (task_id, user_id, title, stamp, stamp),
    )
    conn.commit()
    row = conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
  return {**row_to_dict(row), "done": bool(row["done"])}


@app.patch("/api/tasks/{task_id}")
async def update_task(task_id: str, payload: TaskUpdate) -> dict[str, Any]:
  with open_db() as conn:
    row = conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
    if not row:
      raise HTTPException(status_code=404, detail="Task not found")
    title = row["title"] if payload.title is None else payload.title.strip()
    done = row["done"] if payload.done is None else int(payload.done)
    conn.execute(
      "UPDATE tasks SET title = ?, done = ?, updated_at = ? WHERE id = ?",
      (title, done, now_iso(), task_id),
    )
    conn.commit()
    row = conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
  return {**row_to_dict(row), "done": bool(row["done"])}


@app.delete("/api/tasks/{task_id}")
async def delete_task(task_id: str) -> dict[str, bool]:
  with open_db() as conn:
    conn.execute("DELETE FROM tasks WHERE id = ?", (task_id,))
    conn.commit()
  return {"ok": True}


@app.post("/api/focus-sessions")
async def save_focus_session(payload: FocusSessionCreate) -> dict[str, Any]:
  session_id = new_id("focus")
  with open_db() as conn:
    conn.execute(
      """
      INSERT INTO focus_sessions (id, user_id, room_id, task_title, duration_minutes, completed_at)
      VALUES (?, ?, ?, ?, ?, ?)
      """,
      (
        session_id,
        payload.user_id,
        payload.room_id,
        payload.task_title.strip() or "自由专注",
        payload.duration_minutes,
        now_iso(),
      ),
    )
    conn.commit()
    row = conn.execute("SELECT * FROM focus_sessions WHERE id = ?", (session_id,)).fetchone()
  return row_to_dict(row)


@app.get("/api/users/{user_id}/stats")
async def get_stats(user_id: str) -> dict[str, Any]:
  with open_db() as conn:
    focus = conn.execute(
      """
      SELECT COALESCE(SUM(duration_minutes), 0) AS total_minutes, COUNT(*) AS session_count
      FROM focus_sessions
      WHERE user_id = ?
      """,
      (user_id,),
    ).fetchone()
    tasks = conn.execute(
      """
      SELECT
        COUNT(*) AS task_count,
        COALESCE(SUM(CASE WHEN done = 1 THEN 1 ELSE 0 END), 0) AS completed_count
      FROM tasks
      WHERE user_id = ?
      """,
      (user_id,),
    ).fetchone()
  return {
    "total_minutes": int(focus["total_minutes"]),
    "session_count": int(focus["session_count"]),
    "task_count": int(tasks["task_count"]),
    "completed_count": int(tasks["completed_count"]),
  }


@app.get("/api/leaderboard")
async def get_leaderboard(limit: int = 10) -> list[dict[str, Any]]:
  limit = max(1, min(limit, 50))
  with open_db() as conn:
    rows = conn.execute(
      """
      SELECT
        u.id AS user_id,
        u.username AS username,
        u.display_name AS display_name,
        COALESCE(SUM(f.duration_minutes), 0) AS total_minutes,
        COUNT(f.id) AS session_count,
        MAX(f.completed_at) AS last_completed_at
      FROM users u
      LEFT JOIN focus_sessions f ON f.user_id = u.id
      WHERE u.username IS NOT NULL
      GROUP BY u.id, u.username, u.display_name
      ORDER BY total_minutes DESC, session_count DESC, u.created_at ASC
      LIMIT ?
      """,
      (limit,),
    ).fetchall()

  return [
    {
      "rank": index + 1,
      "user_id": row["user_id"],
      "username": row["username"],
      "display_name": row["display_name"],
      "total_minutes": int(row["total_minutes"]),
      "session_count": int(row["session_count"]),
      "last_completed_at": row["last_completed_at"],
    }
    for index, row in enumerate(rows)
  ]


@app.post("/api/rooms/{room_id}/encouragements")
async def create_encouragement(room_id: str, payload: EncouragementCreate) -> dict[str, Any]:
  item = {
    "id": new_id("card"),
    "room_id": room_id,
    "user_id": payload.user_id,
    "sender_name": payload.sender_name.strip() or "同桌",
    "message": payload.message.strip(),
    "created_at": now_iso(),
  }
  with open_db() as conn:
    conn.execute(
      """
      INSERT INTO encouragements (id, room_id, user_id, sender_name, message, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
      """,
      (item["id"], room_id, item["user_id"], item["sender_name"], item["message"], item["created_at"]),
    )
    conn.commit()
  await hub.broadcast_encouragement(room_id, item)
  return item


@app.websocket("/ws/rooms/{room_id}")
async def room_socket(websocket: WebSocket, room_id: str, user_id: str, display_name: str = "自习同学") -> None:
  with open_db() as conn:
    room = conn.execute("SELECT id FROM rooms WHERE id = ?", (room_id,)).fetchone()
  if not room:
    await websocket.close(code=4404)
    return

  await hub.connect(room_id, websocket, user_id, display_name[:24])
  try:
    while True:
      raw = await websocket.receive_text()
      try:
        message = json.loads(raw)
      except json.JSONDecodeError:
        continue
      if message.get("type") == "state":
        await hub.update_peer(room_id, user_id, message)
      elif message.get("type") == "ping":
        await websocket.send_json({"type": "pong", "at": now_iso()})
  except WebSocketDisconnect:
    await hub.disconnect(room_id, user_id)
  except Exception:
    await hub.disconnect(room_id, user_id)


if __name__ == "__main__":
  uvicorn.run("main:app", host=SERVER_HOST, port=SERVER_PORT, reload=False)
