export type Hex = { q: number; r: number };

export type PlayerColor = 'red' | 'blue' | 'green' | 'yellow' | 'purple' | 'orange';

export type PlayerCount = 2 | 3 | 4 | 6;

export type Marble = { userId: string; color: PlayerColor };

export type GameStatus = 'waiting' | 'active' | 'completed';

export type GameEndReason = 'win' | 'stalemate' | 'resign';

export type FinishedPlayer = { userId: string; finishPos: number };

export type GameState = {
  gameId: string;
  status: GameStatus;
  endReason?: GameEndReason;
  playerCount: PlayerCount;
  turnOrder: string[];
  currentTurnIndex: number;
  moveCount: number;
  timerEndsAt: number;
  timeoutStrikes: Record<string, number>;
  finishedPlayers: FinishedPlayer[];
  board: Map<string, Marble | null>;
  playerColors: Record<string, PlayerColor>;
  playerHomePoint: Record<string, number>;
  // When true, a player may move an enemy marble out of their target zone on
  // their turn (standard step/hop rules, destination must be outside their
  // target zone). Solves the win-condition stalemate.
  blockingRule: boolean;
};

export type Move = {
  fromQ: number;
  fromR: number;
  toQ: number;
  toR: number;
  path: Hex[];
};

export type ValidationReason =
  | 'NOT_YOUR_TURN'
  | 'NO_MARBLE'
  | 'INVALID_DESTINATION'
  | 'PATH_INVALID'
  | 'REVISITED_HOP'
  | 'NOT_BOARD_POSITION'
  | 'WRONG_OWNER'
  | 'BLOCKED'
  | 'GAME_NOT_ACTIVE'
  | 'PLAYER_FINISHED';

export type ValidationResult = { valid: true } | { valid: false; reason: ValidationReason };

export type EloMode = '2p' | 'multi';

export type FinishOrderEntry = {
  userId: string;
  finishPos: number;
  eloDelta: number;
};

export type ChatMessageType = 'text' | 'emote';

export type ChatMessage = {
  id: string;
  userId: string;
  username: string;
  isSpectator: boolean;
  type: ChatMessageType;
  content: string;
  sentAt: number;
};

// ────────────────────────── WebSocket Event Names ──────────────────────────

export const SOCKET_EVENTS = {
  ROOM_JOIN: 'room:join',
  ROOM_LEAVE: 'room:leave',
  GAME_START_REQUEST: 'game:start_request',
  GAME_MOVE_ATTEMPT: 'game:move_attempt',
  GAME_REQUEST_PREVIEW: 'game:request_preview',
  GAME_RESIGN: 'game:resign',
  CHAT_SEND: 'chat:send',
  SPECTATOR_JOIN: 'spectator:join',

  GAME_START: 'game:start',
  GAME_MOVE_CONFIRMED: 'game:move_confirmed',
  GAME_MOVE_REJECTED: 'game:move_rejected',
  GAME_VALID_DESTINATIONS: 'game:valid_destinations',
  GAME_OVER: 'game:over',
  CHAT_MESSAGE: 'chat:message',
  ERROR: 'error',
} as const;

// ────────────────────────── Event Payloads ──────────────────────────

export type RoomJoinPayload = {
  gameId: string;
  token: string;
  // Force spectator mode (skip filling open player seats). Used for share-as-spectator URLs.
  asSpectator?: boolean;
};
export type RoomLeavePayload = { gameId: string };
export type GameMoveAttemptPayload = {
  fromQ: number;
  fromR: number;
  toQ: number;
  toR: number;
  // Optional. Server fills via engine pathfinder when omitted. Pass an explicit
  // path to lock in a specific chain-hop route (e.g., when the user picks waypoints).
  path?: Hex[];
};
export type GameRequestPreviewPayload = { fromQ: number; fromR: number };
export type GameResignPayload = Record<string, never>;
export type ChatSendPayload = { content: string; type: ChatMessageType };
export type SpectatorJoinPayload = { gameId: string };

export type GameStartEvent = {
  gameId: string;
  boardState: Array<[string, Marble | null]>;
  turnOrder: string[];
  currentTurn: string;
  timerEndsAt: number;
  playerCount: PlayerCount;
  playerColors: Record<string, PlayerColor>;
  playerHomePoint: Record<string, number>;
  blockingRule: boolean;
  isReconnect?: boolean;
};

export type GameMoveConfirmedEvent = {
  moveId: string;
  userId: string;
  fromQ: number;
  fromR: number;
  toQ: number;
  toR: number;
  path: Hex[];
  nextTurn: string;
  timerEndsAt: number;
};

export type GameMoveRejectedEvent = { reason: ValidationReason };
export type GameValidDestinationsEvent = { destinations: Hex[] };
export type GameOverEvent = { finishOrder: FinishOrderEntry[]; endReason?: GameEndReason };

export type ErrorEvent = { code: string; message: string };

// ────────────────────────── REST Types ──────────────────────────

export type RoomSummary = {
  gameId: string;
  name: string;
  hostUsername: string;
  playerCount: PlayerCount;
  currentPlayers: number;
  timer: number;
  isPublic: boolean;
  allowSpectators: boolean;
  status: GameStatus;
};

export type UserProfile = {
  id: string;
  username: string;
  avatarUrl: string | null;
  createdAt: string;
  ratings: { mode: EloMode; rating: number; gamesPlayed: number }[];
};
