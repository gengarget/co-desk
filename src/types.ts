export type User = {
  id: string;
  username?: string | null;
  display_name: string;
};

export type Room = {
  id: string;
  name: string;
  description: string;
  created_at: string;
  online_count: number;
};

export type Task = {
  id: string;
  user_id: string;
  title: string;
  done: boolean;
  created_at: string;
  updated_at: string;
};

export type Stats = {
  total_minutes: number;
  session_count: number;
  task_count: number;
  completed_count: number;
};

export type Peer = {
  user_id: string;
  display_name: string;
  seat: number;
  status: string;
  current_task: string;
  timer_label: string;
  ambient: string;
  joined_at: string;
};

export type Encouragement = {
  id: string;
  room_id: string;
  user_id: string;
  sender_name: string;
  message: string;
  created_at: string;
};

export type LeaderboardEntry = {
  rank: number;
  user_id: string;
  username: string;
  display_name: string;
  total_minutes: number;
  session_count: number;
  last_completed_at: string | null;
};

export type RoomSocketMessage =
  | {
      type: "room_state";
      room_id: string;
      online_count: number;
      peers: Peer[];
    }
  | ({
      type: "encouragement";
    } & Encouragement)
  | {
      type: "room_deleted";
      room_id: string;
    }
  | {
      type: "pong";
      at: string;
    };
