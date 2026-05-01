import {
  BarChart3,
  CheckCircle2,
  Circle,
  Headphones,
  MessageCircle,
  Pause,
  Play,
  Plus,
  Radio,
  Send,
  Sparkles,
  Square,
  StickyNote,
  Timer,
  Trash2,
  Users,
  Volume2,
  Wifi,
  WifiOff
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_API_BASE,
  createRoom,
  createTask,
  deleteRoomMessage,
  deleteRoom,
  deleteTask,
  getApiBase,
  getLeaderboard,
  getWsBase,
  getStats,
  listRoomMessages,
  loginUser,
  listRooms,
  listTasks,
  registerUser,
  saveFocusSession,
  sendRoomMessage,
  setApiBase,
  updateRoom,
  updateTask
} from "./api";
import type { LeaderboardEntry, Peer, Room, RoomMessage, RoomSocketMessage, Stats, Task, User } from "./types";

const FOCUS_SECONDS = 25 * 60;

const ambientOptions = [
  { id: "library", label: "图书馆底噪" },
  { id: "rain", label: "雨夜自习室" },
  { id: "cafe", label: "低语咖啡馆" }
];

const chatQuickOptions = ["稳住，先学 25 分钟", "给你递一杯咖啡", "这题慢慢拆，能搞定"];
const AUTH_USER_KEY = "codesk_auth_user";

function formatTime(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function formatChatTime(value: string) {
  try {
    return new Intl.DateTimeFormat("zh-CN", {
      hour: "2-digit",
      minute: "2-digit"
    }).format(new Date(value));
  } catch {
    return "";
  }
}

function appendRoomMessage(previous: RoomMessage[], message: RoomMessage) {
  if (previous.some((item) => item.id === message.id)) return previous;
  return [...previous, message].slice(-80);
}

function readStoredUser(): User | null {
  try {
    const raw = localStorage.getItem(AUTH_USER_KEY);
    return raw ? (JSON.parse(raw) as User) : null;
  } catch {
    return null;
  }
}

function buildWsUrl(roomId: string, user: User) {
  const params = new URLSearchParams({
    user_id: user.id,
    display_name: user.display_name
  });
  return `${getWsBase()}/ws/rooms/${encodeURIComponent(roomId)}?${params.toString()}`;
}

export default function App() {
  const [user, setUser] = useState<User | null>(() => readStoredUser());
  const [displayName, setDisplayName] = useState(() => readStoredUser()?.display_name ?? "第4小组同学");
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [authUsername, setAuthUsername] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authDisplayName, setAuthDisplayName] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [serverBase, setServerBase] = useState(() => getApiBase());
  const [rooms, setRooms] = useState<Room[]>([]);
  const [activeRoom, setActiveRoom] = useState<Room | null>(null);
  const [newRoomName, setNewRoomName] = useState("");
  const [editingRoomId, setEditingRoomId] = useState<string | null>(null);
  const [editingRoomName, setEditingRoomName] = useState("");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [stats, setStats] = useState<Stats>({
    total_minutes: 0,
    session_count: 0,
    task_count: 0,
    completed_count: 0
  });
  const [peers, setPeers] = useState<Peer[]>([]);
  const [roomMessages, setRoomMessages] = useState<RoomMessage[]>([]);
  const [chatDraft, setChatDraft] = useState("");
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [preferredSeat, setPreferredSeat] = useState<number | null>(null);
  const [connection, setConnection] = useState<"connecting" | "online" | "offline">("offline");
  const [remaining, setRemaining] = useState(FOCUS_SECONDS);
  const [running, setRunning] = useState(false);
  const [ambientId, setAmbientId] = useState(ambientOptions[0].id);
  const [audioOn, setAudioOn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [serverSaved, setServerSaved] = useState(true);

  const wsRef = useRef<WebSocket | null>(null);
  const runningRef = useRef(false);
  const focusStartedAtRef = useRef<number | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const stopAudioRef = useRef<Array<() => void>>([]);
  const chatFeedRef = useRef<HTMLDivElement | null>(null);

  const selectedTask = useMemo(() => {
    if (selectedTaskId) {
      const found = tasks.find((task) => task.id === selectedTaskId);
      if (found && !found.done) return found;
    }
    return tasks.find((task) => !task.done) ?? null;
  }, [selectedTaskId, tasks]);

  const currentTaskTitle = selectedTask?.title ?? "自由专注";
  const ambientLabel = ambientOptions.find((item) => item.id === ambientId)?.label ?? "图书馆底噪";
  const activeRoomId = activeRoom?.id;

  const getRoomPeerCount = useCallback(
    (room: Room) => {
      const total = room.online_count ?? 0;
      if (user && room.id === activeRoomId) return Math.max(0, total - 1);
      return total;
    },
    [activeRoomId, user]
  );

  function applyServerBase() {
    setApiBase(serverBase || DEFAULT_API_BASE);
    setServerBase(getApiBase());
    setServerSaved(true);
    setError(null);
    setRooms([]);
    setActiveRoom(null);
    setPeers([]);
    setRoomMessages([]);
    void reloadRooms().catch((caught: Error) => setError(caught.message));
    if (user) {
      void reloadTasks(user).catch((caught: Error) => setError(caught.message));
      void reloadStats(user).catch((caught: Error) => setError(caught.message));
    }
    void reloadLeaderboard().catch((caught: Error) => setError(caught.message));
  }

  const reloadRooms = useCallback(async () => {
    const roomList = await listRooms();
    setRooms(roomList);
    setActiveRoom((previous) => {
      if (!previous) return roomList[0] ?? null;
      return roomList.find((room) => room.id === previous.id) ?? roomList[0] ?? null;
    });
  }, []);

  const reloadTasks = useCallback(async (targetUser: User) => {
    const taskList = await listTasks(targetUser.id);
    setTasks(taskList);
    setSelectedTaskId((previous) => previous ?? taskList.find((task) => !task.done)?.id ?? null);
  }, []);

  const reloadStats = useCallback(async (targetUser: User) => {
    setStats(await getStats(targetUser.id));
  }, []);

  const reloadLeaderboard = useCallback(async () => {
    setLeaderboard(await getLeaderboard(10));
  }, []);

  useEffect(() => {
    reloadRooms().catch((caught: Error) => setError(caught.message));
    reloadLeaderboard().catch((caught: Error) => setError(caught.message));
  }, [reloadLeaderboard, reloadRooms]);

  useEffect(() => {
    if (!user) return;
    reloadTasks(user).catch((caught: Error) => setError(caught.message));
    reloadStats(user).catch((caught: Error) => setError(caught.message));
  }, [reloadStats, reloadTasks, user]);

  useEffect(() => {
    let cancelled = false;
    if (!activeRoomId) {
      setRoomMessages([]);
      return () => {
        cancelled = true;
      };
    }
    setRoomMessages([]);
    listRoomMessages(activeRoomId)
      .then((messages) => {
        if (!cancelled) setRoomMessages(messages);
      })
      .catch((caught: Error) => {
        if (!cancelled) setError(caught.message);
      });
    return () => {
      cancelled = true;
    };
  }, [activeRoomId]);

  useEffect(() => {
    const feed = chatFeedRef.current;
    if (!feed) return;
    feed.scrollTop = feed.scrollHeight;
  }, [activeRoomId, roomMessages.length]);

  useEffect(() => {
    if (!user || !activeRoomId) return;
    setConnection("connecting");
    const socket = new WebSocket(buildWsUrl(activeRoomId, user));
    wsRef.current = socket;

    socket.onopen = () => setConnection("online");
    socket.onclose = () => {
      if (wsRef.current === socket) {
        setConnection("offline");
        setPeers([]);
      }
      window.setTimeout(() => {
        void reloadRooms().catch((caught: Error) => setError(caught.message));
      }, 350);
    };
    socket.onerror = () => setConnection("offline");
    socket.onmessage = (event) => {
      const message = JSON.parse(event.data) as RoomSocketMessage;
      if (message.type === "room_state") {
        setPeers(message.peers);
        const me = message.peers.find((peer) => peer.user_id === user?.id);
        if (me) setPreferredSeat(me.seat);
        setRooms((previous) =>
          previous.map((room) =>
            room.id === message.room_id ? { ...room, online_count: message.online_count } : room
          )
        );
        setActiveRoom((previous) =>
          previous && previous.id === message.room_id
            ? { ...previous, online_count: message.online_count }
            : previous
        );
      }
      if (message.type === "message_created" && message.room_id === activeRoomId) {
        setRoomMessages((previous) => appendRoomMessage(previous, message));
      }
      if (message.type === "message_deleted" && message.room_id === activeRoomId) {
        setRoomMessages((previous) => previous.filter((item) => item.id !== message.id));
      }
      if (message.type === "encouragement" && message.room_id === activeRoomId) {
        setRoomMessages((previous) => appendRoomMessage(previous, message));
      }
      if (message.type === "room_deleted") {
        void reloadRooms().catch((caught: Error) => setError(caught.message));
      }
    };

    return () => {
      socket.close();
      if (wsRef.current === socket) wsRef.current = null;
      window.setTimeout(() => {
        void reloadRooms().catch((caught: Error) => setError(caught.message));
      }, 350);
    };
  }, [activeRoomId, reloadRooms, user?.display_name, user?.id]);

  useEffect(() => {
    runningRef.current = running;
  }, [running]);

  const broadcastState = useCallback(() => {
    const socket = wsRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(
      JSON.stringify({
        type: "state",
        status: running ? "专注中" : "准备中",
        current_task: currentTaskTitle,
        timer_label: formatTime(remaining),
        ambient: ambientLabel
      })
    );
  }, [ambientLabel, currentTaskTitle, remaining, running]);

  useEffect(() => {
    broadcastState();
  }, [ambientLabel, currentTaskTitle, running]);

  const finishFocus = useCallback(
    async (save: boolean) => {
      const startedAt = focusStartedAtRef.current;
      focusStartedAtRef.current = null;
      runningRef.current = false;
      setRunning(false);
      setRemaining(FOCUS_SECONDS);

      if (!save || !startedAt || !user) return;
      const elapsedSeconds = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
      if (elapsedSeconds < 5) return;
      await saveFocusSession({
        user_id: user.id,
        room_id: activeRoom?.id,
        task_title: currentTaskTitle,
        duration_minutes: Math.max(1, Math.round(elapsedSeconds / 60))
      });
      await reloadStats(user);
      await reloadLeaderboard();
    },
    [activeRoom?.id, currentTaskTitle, reloadLeaderboard, reloadStats, user]
  );

  useEffect(() => {
    if (!running) return;
    const intervalId = window.setInterval(() => {
      setRemaining((previous) => {
        if (previous <= 1) {
          window.setTimeout(() => void finishFocus(true), 0);
          return FOCUS_SECONDS;
        }
        return previous - 1;
      });
    }, 1000);
    return () => window.clearInterval(intervalId);
  }, [finishFocus, running]);

  function getAudioContext() {
    const AudioContextCtor =
      window.AudioContext ||
      (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) throw new Error("当前系统不支持 Web Audio");
    audioCtxRef.current ??= new AudioContextCtor();
    return audioCtxRef.current;
  }

  function clearAmbientAudio() {
    stopAudioRef.current.forEach((stop) => stop());
    stopAudioRef.current = [];
  }

  function createNoiseSource(ctx: AudioContext) {
    const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let index = 0; index < data.length; index += 1) {
      data[index] = Math.random() * 2 - 1;
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    return source;
  }

  function createSoftRainSource(ctx: AudioContext) {
    const buffer = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let smooth = 0;
    for (let index = 0; index < data.length; index += 1) {
      smooth = smooth * 0.965 + (Math.random() * 2 - 1) * 0.035;
      data[index] = smooth * 1.8;
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    return source;
  }

  function startRainNightAudio(ctx: AudioContext) {
    const rainGain = ctx.createGain();
    rainGain.gain.value = 0.13;
    rainGain.connect(ctx.destination);
    stopAudioRef.current.push(() => rainGain.disconnect());

    const rain = createSoftRainSource(ctx);
    const rainLowpass = ctx.createBiquadFilter();
    rainLowpass.type = "lowpass";
    rainLowpass.frequency.value = 1150;
    rainLowpass.Q.value = 0.35;
    rain.connect(rainLowpass);
    rainLowpass.connect(rainGain);
    rain.start();
    stopAudioRef.current.push(() => {
      rain.stop();
      rain.disconnect();
      rainLowpass.disconnect();
    });

    const createDrop = () => {
      const drop = createNoiseSource(ctx);
      const dropFilter = ctx.createBiquadFilter();
      const dropGain = ctx.createGain();
      dropFilter.type = "bandpass";
      dropFilter.frequency.value = 1700 + Math.random() * 1300;
      dropFilter.Q.value = 5 + Math.random() * 5;
      dropGain.gain.setValueAtTime(0.001, ctx.currentTime);
      dropGain.gain.exponentialRampToValueAtTime(0.012 + Math.random() * 0.012, ctx.currentTime + 0.018);
      dropGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.16 + Math.random() * 0.12);
      drop.connect(dropFilter);
      dropFilter.connect(dropGain);
      dropGain.connect(rainGain);
      drop.start();
      drop.stop(ctx.currentTime + 0.35);
    };

    const intervalId = window.setInterval(createDrop, 420 + Math.random() * 360);
    stopAudioRef.current.push(() => window.clearInterval(intervalId));
  }

  async function startAmbientAudio(mode: string) {
    const ctx = getAudioContext();
    await ctx.resume();
    clearAmbientAudio();

    if (mode === "rain") {
      startRainNightAudio(ctx);
      return;
    }

    const gain = ctx.createGain();
    gain.gain.value = mode === "cafe" ? 0.16 : 0.22;
    gain.connect(ctx.destination);
    stopAudioRef.current.push(() => gain.disconnect());

    const noise = createNoiseSource(ctx);
    const filter = ctx.createBiquadFilter();
    filter.type = mode === "rain" ? "highpass" : "lowpass";
    filter.frequency.value = mode === "rain" ? 900 : mode === "cafe" ? 520 : 360;
    noise.connect(filter);
    filter.connect(gain);
    noise.start();
    stopAudioRef.current.push(() => {
      noise.stop();
      noise.disconnect();
      filter.disconnect();
    });

    if (mode === "cafe") {
      const hum = ctx.createOscillator();
      const humGain = ctx.createGain();
      hum.type = "sine";
      hum.frequency.value = 120;
      humGain.gain.value = 0.02;
      hum.connect(humGain);
      humGain.connect(gain);
      hum.start();
      stopAudioRef.current.push(() => {
        hum.stop();
        hum.disconnect();
        humGain.disconnect();
      });
    }
  }

  async function toggleAmbientAudio() {
    if (audioOn) {
      clearAmbientAudio();
      setAudioOn(false);
      return;
    }
    await startAmbientAudio(ambientId);
    setAudioOn(true);
  }

  useEffect(() => {
    if (!audioOn) return;
    void startAmbientAudio(ambientId);
    return undefined;
  }, [ambientId]);

  useEffect(() => {
    return () => clearAmbientAudio();
  }, []);

  async function playSeatCue(seat: number) {
    const ctx = getAudioContext();
    await ctx.resume();
    const source = createNoiseSource(ctx);
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    const panner = ctx.createStereoPanner();
    const panMap = [-0.85, -0.45, 0.45, 0.85, -0.2, 0.2, 0];
    panner.pan.value = panMap[(seat - 1) % panMap.length];
    filter.type = "bandpass";
    filter.frequency.value = 900 + seat * 70;
    gain.gain.setValueAtTime(0.001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.16, ctx.currentTime + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.22);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(panner);
    panner.connect(ctx.destination);
    source.start();
    source.stop(ctx.currentTime + 0.24);
  }

  function handleSeatClick(seat: number, peer?: Peer) {
    if (peer && peer.user_id !== user?.id) {
      void playSeatCue(seat);
      return;
    }
    const socket = wsRef.current;
    setPreferredSeat(seat);
    if (user) {
      setPeers((previous) =>
        previous.map((item) =>
          item.user_id === user.id ? { ...item, seat } : item
        )
      );
    }
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "move_seat", seat }));
    }
    void playSeatCue(seat);
  }

  function startFocus() {
    if (running) return;
    focusStartedAtRef.current = Date.now();
    setRunning(true);
  }

  async function handleAuth(event: FormEvent) {
    event.preventDefault();
    setAuthLoading(true);
    setError(null);
    try {
      const result =
        authMode === "register"
          ? await registerUser({
              username: authUsername,
              password: authPassword,
              display_name: authDisplayName || authUsername
            })
          : await loginUser({
              username: authUsername,
              password: authPassword
            });

      localStorage.setItem(AUTH_USER_KEY, JSON.stringify(result.user));
      localStorage.removeItem("codesk_user");
      setUser(result.user);
      setDisplayName(result.user.display_name);
      setAuthPassword("");
      setAuthDisplayName("");
      await reloadTasks(result.user);
      await reloadStats(result.user);
      await reloadLeaderboard();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "登录失败");
    } finally {
      setAuthLoading(false);
    }
  }

  function handleLogout() {
    wsRef.current?.close();
    localStorage.removeItem(AUTH_USER_KEY);
    localStorage.removeItem("codesk_user");
    setUser(null);
    setTasks([]);
    setPeers([]);
    setRoomMessages([]);
    setSelectedTaskId(null);
    setConnection("offline");
  }

  async function handleCreateRoom(event: FormEvent) {
    event.preventDefault();
    const name = newRoomName.trim();
    if (!name) return;
    const room = await createRoom(name, "小组自定义自习房");
    setRooms((previous) => [...previous, room]);
    setActiveRoom(room);
    setNewRoomName("");
  }

  function handleSelectRoom(room: Room) {
    if (editingRoomId) return;
    if (activeRoom?.id && activeRoom.id !== room.id && user) {
      setRooms((previous) =>
        previous.map((item) =>
          item.id === activeRoom.id
            ? { ...item, online_count: Math.max(0, item.online_count - 1) }
            : item
        )
      );
    }
    setPeers([]);
    setPreferredSeat(null);
    setActiveRoom(room);
  }

  function startEditRoom(room: Room) {
    setEditingRoomId(room.id);
    setEditingRoomName(room.name);
  }

  async function handleRenameRoom(event: FormEvent) {
    event.preventDefault();
    if (!editingRoomId) return;
    const name = editingRoomName.trim();
    if (!name) return;
    const updated = await updateRoom(editingRoomId, { name });
    setRooms((previous) => previous.map((room) => (room.id === updated.id ? updated : room)));
    setActiveRoom((previous) => (previous?.id === updated.id ? updated : previous));
    setEditingRoomId(null);
    setEditingRoomName("");
  }

  async function handleDeleteRoom(room: Room) {
    const confirmed = window.confirm(`确定删除「${room.name}」吗？房间内的鼓励卡会被清理。`);
    if (!confirmed) return;
    await deleteRoom(room.id);
    setRooms((previous) => {
      const nextRooms = previous.filter((item) => item.id !== room.id);
      if (activeRoom?.id === room.id) {
        setActiveRoom(nextRooms[0] ?? null);
        setPeers([]);
        setPreferredSeat(null);
      }
      return nextRooms;
    });
    if (editingRoomId === room.id) {
      setEditingRoomId(null);
      setEditingRoomName("");
    }
  }

  async function handleAddTask(event: FormEvent) {
    event.preventDefault();
    if (!user) return;
    const title = newTaskTitle.trim();
    if (!title) return;
    const task = await createTask(user.id, title);
    setTasks((previous) => [task, ...previous]);
    setSelectedTaskId(task.id);
    setNewTaskTitle("");
    await reloadStats(user);
  }

  async function handleToggleTask(task: Task) {
    const updated = await updateTask(task.id, { done: !task.done });
    setTasks((previous) => previous.map((item) => (item.id === updated.id ? updated : item)));
    if (updated.done && selectedTaskId === updated.id) setSelectedTaskId(null);
    if (user) await reloadStats(user);
  }

  async function handleDeleteTask(task: Task) {
    await deleteTask(task.id);
    setTasks((previous) => previous.filter((item) => item.id !== task.id));
    if (selectedTaskId === task.id) setSelectedTaskId(null);
    if (user) await reloadStats(user);
  }

  async function handleBreakdownTask(task: Task) {
    if (!user) return;
    const pieces = [
      `${task.title} - 收集资料和范围`,
      `${task.title} - 完成 25 分钟推进`,
      `${task.title} - 记录卡点并复盘`
    ];
    const created: Task[] = [];
    for (const title of pieces) {
      created.push(await createTask(user.id, title));
    }
    setTasks((previous) => [...created, ...previous]);
    setSelectedTaskId(created[0]?.id ?? task.id);
    await reloadStats(user);
  }

  async function handleSendChatMessage(message?: string) {
    if (!user || !activeRoom) return;
    const text = (message ?? chatDraft).trim();
    if (!text) return;
    try {
      const created = await sendRoomMessage(activeRoom.id, {
        user_id: user.id,
        sender_name: user.display_name,
        message: text
      });
      setRoomMessages((previous) => appendRoomMessage(previous, created));
      if (!message) setChatDraft("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "发送消息失败");
    }
  }

  async function handleChatSubmit(event: FormEvent) {
    event.preventDefault();
    await handleSendChatMessage();
  }

  async function handleDeleteChatMessage(message: RoomMessage) {
    if (!user || !activeRoom) return;
    try {
      await deleteRoomMessage(activeRoom.id, message.id, user.id);
      setRoomMessages((previous) => previous.filter((item) => item.id !== message.id));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "撤回消息失败");
    }
  }

  const seatSlots = Array.from({ length: 6 }, (_, index) =>
    peers.find((peer) => peer.seat === index + 1)
  );

  if (!user) {
    return (
      <div className="auth-shell">
        <section className="auth-card">
          <div className="brand auth-brand">
            <div className="brand-mark">CD</div>
            <div>
              <strong>Co-Desk</strong>
              <span>登录后开始联机自习</span>
            </div>
          </div>

          {error && (
            <button className="error-banner" onClick={() => setError(null)}>
              {error}
            </button>
          )}

          <form className="auth-form" onSubmit={(event) => void handleAuth(event)}>
            <div className="auth-tabs">
              <button
                type="button"
                className={authMode === "login" ? "active" : ""}
                onClick={() => setAuthMode("login")}
              >
                登录
              </button>
              <button
                type="button"
                className={authMode === "register" ? "active" : ""}
                onClick={() => setAuthMode("register")}
              >
                注册
              </button>
            </div>

            <label className="field-label" htmlFor="auth-username">用户名</label>
            <input
              id="auth-username"
              className="text-input"
              value={authUsername}
              minLength={3}
              maxLength={24}
              placeholder="3-24 位字母、数字或下划线"
              onChange={(event) => setAuthUsername(event.target.value)}
              required
            />

            <label className="field-label" htmlFor="auth-password">密码</label>
            <input
              id="auth-password"
              className="text-input"
              value={authPassword}
              minLength={6}
              maxLength={72}
              type="password"
              placeholder="至少 6 位"
              onChange={(event) => setAuthPassword(event.target.value)}
              required
            />

            {authMode === "register" && (
              <>
                <label className="field-label" htmlFor="auth-display-name">显示昵称</label>
                <input
                  id="auth-display-name"
                  className="text-input"
                  value={authDisplayName}
                  maxLength={24}
                  placeholder="排行榜和房间里显示的名字"
                  onChange={(event) => setAuthDisplayName(event.target.value)}
                />
              </>
            )}

            <label className="field-label" htmlFor="auth-server">后端服务器</label>
            <div className="server-config">
              <input
                id="auth-server"
                className="text-input"
                value={serverBase}
                placeholder="https://co-desk-api.onrender.com"
                onChange={(event) => {
                  setServerBase(event.target.value);
                  setServerSaved(false);
                }}
              />
              <button className="icon-button dark" aria-label="保存服务器" type="button" onClick={applyServerBase}>
                <Wifi size={18} />
              </button>
            </div>
            <span className={`server-hint ${serverSaved ? "saved" : ""}`}>
              {serverSaved ? "当前账号会连接这个地址" : "修改后点击右侧按钮生效"}
            </span>

            <button className="primary-action auth-submit" type="submit" disabled={authLoading}>
              {authLoading ? "处理中..." : authMode === "register" ? "创建账号" : "登录 Co-Desk"}
            </button>
          </form>
        </section>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">CD</div>
          <div>
            <strong>Co-Desk</strong>
            <span>沉浸式共创自习桌</span>
          </div>
        </div>

        <section className="sidebar-section">
          <label className="field-label" htmlFor="display-name">账号身份</label>
          <input
            id="display-name"
            className="text-input"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            onBlur={() => {
              if (!user) return;
              const nextUser = { ...user, display_name: displayName.trim() || user.display_name };
              localStorage.setItem(AUTH_USER_KEY, JSON.stringify(nextUser));
              setUser(nextUser);
            }}
          />
          <span className="server-hint saved">@{user.username ?? "guest"}</span>
          <button className="logout-button" type="button" onClick={handleLogout}>
            退出登录
          </button>
        </section>

        <section className="sidebar-section">
          <label className="field-label" htmlFor="server-base">后端服务器</label>
          <div className="server-config">
            <input
              id="server-base"
              className="text-input"
              value={serverBase}
              placeholder="https://your-codesk-api.onrender.com"
              onChange={(event) => {
                setServerBase(event.target.value);
                setServerSaved(false);
              }}
            />
            <button className="icon-button dark" aria-label="连接服务器" onClick={applyServerBase}>
              <Wifi size={18} />
            </button>
          </div>
          <span className={`server-hint ${serverSaved ? "saved" : ""}`}>
            {serverSaved ? "当前客户端会连接这个地址" : "修改后点击右侧按钮生效"}
          </span>
        </section>

        <section className="sidebar-section room-list">
          <div className="section-heading">
            <Users size={16} />
            <span>自习房间</span>
          </div>
          {rooms.map((room) => (
            <div className={`room-row ${activeRoom?.id === room.id ? "active" : ""}`} key={room.id}>
              {editingRoomId === room.id ? (
                <form className="room-edit-form" onSubmit={(event) => void handleRenameRoom(event)}>
                  <input
                    className="text-input"
                    value={editingRoomName}
                    autoFocus
                    maxLength={32}
                    onChange={(event) => setEditingRoomName(event.target.value)}
                  />
                  <button className="mini-button primary" type="submit">保存</button>
                  <button className="mini-button" type="button" onClick={() => setEditingRoomId(null)}>取消</button>
                </form>
              ) : (
                <>
                  <button className="room-button" onClick={() => handleSelectRoom(room)}>
                    <span>{room.name}</span>
                    <small>
                      {getRoomPeerCount(room) > 0
                        ? `${getRoomPeerCount(room)} 位同伴在线`
                        : "暂无同伴在线"}
                    </small>
                  </button>
                  <div className="room-actions">
                    <button className="mini-button" type="button" onClick={() => startEditRoom(room)}>改名</button>
                    <button className="mini-button danger" type="button" onClick={() => void handleDeleteRoom(room)}>
                      删除
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
        </section>

        <form className="new-room" onSubmit={(event) => void handleCreateRoom(event)}>
          <input
            className="text-input"
            placeholder="新建小组自习房"
            value={newRoomName}
            onChange={(event) => setNewRoomName(event.target.value)}
          />
          <button className="icon-button dark" aria-label="新建房间" type="submit">
            <Plus size={18} />
          </button>
        </form>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            <span className="eyebrow">当前房间</span>
            <h1>{activeRoom?.name ?? "正在连接自习室"}</h1>
          </div>
          <div className={`connection ${connection}`}>
            {connection === "online" ? <Wifi size={16} /> : <WifiOff size={16} />}
            <span>{connection === "online" ? "实时同步中" : connection === "connecting" ? "连接中" : "离线"}</span>
          </div>
        </header>

        {error && (
          <button className="error-banner" onClick={() => setError(null)}>
            {error}
          </button>
        )}

        <section className="desk-grid">
          <div className="timer-panel">
            <div className="panel-title">
              <Timer size={18} />
              <span>沉浸番茄钟</span>
            </div>
            <div className="timer-display">{formatTime(remaining)}</div>
            <p className="focus-task">{currentTaskTitle}</p>
            <div className="timer-actions">
              <button className="primary-action" onClick={startFocus} disabled={running}>
                <Play size={18} />
                开始专注
              </button>
              <button className="quiet-action" onClick={() => void finishFocus(true)} disabled={!running}>
                <Square size={16} />
                结束并保存
              </button>
            </div>
          </div>

          <div className="task-panel">
            <div className="panel-title">
              <StickyNote size={18} />
              <span>待办便利贴</span>
            </div>
            <form className="task-form" onSubmit={(event) => void handleAddTask(event)}>
              <input
                className="text-input"
                placeholder="输入现在要推进的任务"
                value={newTaskTitle}
                onChange={(event) => setNewTaskTitle(event.target.value)}
              />
              <button className="icon-button dark" aria-label="添加任务" type="submit">
                <Plus size={18} />
              </button>
            </form>
            <div className="task-list">
              {tasks.length === 0 && <div className="empty-state">先写下一件具体的小任务。</div>}
              {tasks.map((task) => (
                <article
                  className={`task-item ${task.done ? "done" : ""} ${
                    selectedTask?.id === task.id ? "selected" : ""
                  }`}
                  key={task.id}
                >
                  <button
                    className="task-check"
                    aria-label={task.done ? "标记未完成" : "标记完成"}
                    onClick={() => void handleToggleTask(task)}
                  >
                    {task.done ? <CheckCircle2 size={20} /> : <Circle size={20} />}
                  </button>
                  <button className="task-title" onClick={() => setSelectedTaskId(task.id)}>
                    {task.title}
                  </button>
                  <button className="chip-button" onClick={() => void handleBreakdownTask(task)}>
                    <Sparkles size={14} />
                    拆解
                  </button>
                  <button className="icon-button ghost" aria-label="删除任务" onClick={() => void handleDeleteTask(task)}>
                    <Trash2 size={16} />
                  </button>
                </article>
              ))}
            </div>
          </div>
        </section>
      </main>

      <aside className="right-rail">
        <section className="rail-section">
          <div className="section-heading">
            <Radio size={16} />
            <span>同伴座位</span>
          </div>
          <div className="seat-grid">
            {seatSlots.map((peer, index) => (
              <button
                className={`seat ${peer ? "occupied" : ""} ${peer?.user_id === user?.id ? "mine" : ""}`}
                key={index}
                onClick={() => handleSeatClick(index + 1, peer)}
                title={peer && peer.user_id !== user?.id ? "这个座位已被占用" : "点击选择这个空位"}
              >
                <strong>{peer ? (peer.user_id === user?.id ? "我" : peer.display_name.slice(0, 2)) : index + 1}</strong>
                <span>
                  {peer
                    ? peer.user_id === user?.id
                      ? `我的座位 · ${peer.status}`
                      : peer.status
                    : "点击入座"}
                </span>
              </button>
            ))}
          </div>
        </section>

        <section className="rail-section">
          <div className="section-heading">
            <Headphones size={16} />
            <span>环境音</span>
          </div>
          <select className="text-input" value={ambientId} onChange={(event) => setAmbientId(event.target.value)}>
            {ambientOptions.map((item) => (
              <option value={item.id} key={item.id}>
                {item.label}
              </option>
            ))}
          </select>
          <button className="audio-button" onClick={() => void toggleAmbientAudio()}>
            {audioOn ? <Pause size={18} /> : <Volume2 size={18} />}
            {audioOn ? "暂停环境音" : "播放环境音"}
          </button>
        </section>

        <section className="rail-section chat-panel">
          <div className="section-heading">
            <MessageCircle size={16} />
            <span>版聊</span>
          </div>
          <div className="chat-quick-actions">
            {chatQuickOptions.map((message) => (
              <button key={message} onClick={() => void handleSendChatMessage(message)}>
                {message}
              </button>
            ))}
          </div>
          <div className="chat-feed" ref={chatFeedRef}>
            {roomMessages.length === 0 && <span className="chat-empty">房间版聊消息会保留在这里。</span>}
            {roomMessages.map((message) => (
              <article
                className={`chat-message ${message.user_id === user.id ? "mine" : ""}`}
                key={message.id}
              >
                <div className="chat-message-meta">
                  <strong>{message.sender_name}</strong>
                  <time>{formatChatTime(message.created_at)}</time>
                  {message.user_id === user.id && (
                    <button
                      className="message-delete"
                      type="button"
                      onClick={() => void handleDeleteChatMessage(message)}
                    >
                      撤回
                    </button>
                  )}
                </div>
                <p>{message.message}</p>
              </article>
            ))}
          </div>
          <form className="chat-form" onSubmit={(event) => void handleChatSubmit(event)}>
            <input
              className="text-input"
              maxLength={280}
              placeholder="发一条版聊消息"
              value={chatDraft}
              onChange={(event) => setChatDraft(event.target.value)}
            />
            <button
              className="icon-button dark"
              aria-label="发送版聊消息"
              type="submit"
              disabled={!chatDraft.trim() || !activeRoom}
            >
              <Send size={16} />
            </button>
          </form>
        </section>

        <section className="rail-section stats">
          <div className="section-heading">
            <BarChart3 size={16} />
            <span>专注记录</span>
          </div>
          <div className="stat-row">
            <strong>{stats.total_minutes}</strong>
            <span>累计分钟</span>
          </div>
          <div className="stat-row">
            <strong>{stats.session_count}</strong>
            <span>专注轮次</span>
          </div>
          <div className="stat-row">
            <strong>{stats.completed_count}/{stats.task_count}</strong>
            <span>完成任务</span>
          </div>
        </section>

        <section className="rail-section leaderboard">
          <div className="section-heading">
            <Users size={16} />
            <span>自习时间排行榜</span>
          </div>
          <div className="leaderboard-list">
            {leaderboard.length === 0 && <span className="empty-leaderboard">完成一次专注后就会上榜。</span>}
            {leaderboard.map((entry) => (
              <div className={`leaderboard-row ${entry.user_id === user.id ? "me" : ""}`} key={entry.user_id}>
                <strong>{entry.rank}</strong>
                <div>
                  <span>{entry.display_name}</span>
                  <small>{entry.session_count} 轮专注</small>
                </div>
                <b>{entry.total_minutes} 分钟</b>
              </div>
            ))}
          </div>
        </section>
      </aside>
    </div>
  );
}
