import { create } from 'zustand';
import type {
  GameMoveConfirmedEvent,
  GameStartEvent,
  Hex,
  Marble,
  PlayerColor,
} from '@cc/shared-types';

export type AnimatingMove = {
  userId: string;
  path: Hex[];
  startedAt: number;
  duration: number;
};

type GameSliceState = {
  gameId: string | null;
  status: 'idle' | 'waiting' | 'active' | 'completed';
  board: Map<string, Marble | null>;
  turnOrder: string[];
  currentTurn: string | null;
  timerEndsAt: number;
  playerColors: Record<string, PlayerColor>;
  playerHomePoint: Record<string, number>;
  blockingRule: boolean;
  isSpectator: boolean;
  selectedMarble: Hex | null;
  cursor: Hex | null;
  validDestinations: Set<string>;
  animatingMove: AnimatingMove | null;
  pendingAnimations: Array<{ from: Hex; to: Hex; path: Hex[]; userId: string }>;
  finishOrder: Array<{ userId: string; finishPos: number; eloDelta: number }> | null;
  lastMove: { from: Hex; to: Hex } | null;
  moveHistory: Array<{ userId: string; from: Hex; to: Hex; pathLength: number; at: number }>;
  transientHighlight: { hex: Hex; startedAt: number } | null;

  startGame: (e: GameStartEvent) => void;
  applyConfirmedMove: (e: GameMoveConfirmedEvent) => void;
  completeAnimation: () => void;
  setSelected: (h: Hex | null) => void;
  setCursor: (h: Hex | null) => void;
  setValidDestinations: (cells: Hex[]) => void;
  setIsSpectator: (v: boolean) => void;
  finishGame: (finishOrder: GameSliceState['finishOrder']) => void;
  setTransientHighlight: (h: Hex | null) => void;
  reset: () => void;
};

const initial = {
  gameId: null,
  status: 'idle' as const,
  board: new Map<string, Marble | null>(),
  turnOrder: [],
  currentTurn: null,
  timerEndsAt: 0,
  playerColors: {},
  playerHomePoint: {},
  blockingRule: false,
  isSpectator: false,
  selectedMarble: null,
  cursor: null,
  validDestinations: new Set<string>(),
  animatingMove: null,
  pendingAnimations: [],
  finishOrder: null,
  lastMove: null,
  moveHistory: [],
  transientHighlight: null,
};

export const useGameStore = create<GameSliceState>((set) => ({
  ...initial,
  startGame: (e) =>
    set({
      gameId: e.gameId,
      status: 'active',
      board: new Map(e.boardState),
      turnOrder: e.turnOrder,
      currentTurn: e.currentTurn,
      timerEndsAt: e.timerEndsAt,
      playerColors: e.playerColors,
      playerHomePoint: e.playerHomePoint,
      blockingRule: e.blockingRule,
      selectedMarble: null,
      validDestinations: new Set(),
      animatingMove: null,
      finishOrder: null,
      lastMove: null,
      moveHistory: [],
    }),
  applyConfirmedMove: (e) =>
    set((s) => {
      // Apply board state immediately so the model is always current; queue
      // the visual animation behind any in-flight one so marbles don't snap.
      const board = new Map(s.board);
      const fromKey = `${e.fromQ},${e.fromR}`;
      const toKey = `${e.toQ},${e.toR}`;
      const marble = board.get(fromKey) ?? null;
      board.set(fromKey, null);
      board.set(toKey, marble);

      const newAnim = {
        userId: e.userId,
        path: e.path,
        startedAt: performance.now(),
        duration: 400 * Math.max(1, e.path.length - 1),
      };

      const historyEntry = {
        userId: e.userId,
        from: { q: e.fromQ, r: e.fromR },
        to: { q: e.toQ, r: e.toR },
        pathLength: e.path.length - 1,
        at: Date.now(),
      };

      const baseUpdate = {
        board,
        currentTurn: e.nextTurn,
        timerEndsAt: e.timerEndsAt,
        selectedMarble: null,
        validDestinations: new Set<string>(),
        lastMove: { from: { q: e.fromQ, r: e.fromR }, to: { q: e.toQ, r: e.toR } },
        moveHistory: [...s.moveHistory.slice(-49), historyEntry],
      };

      if (s.animatingMove) {
        return {
          ...baseUpdate,
          pendingAnimations: [
            ...s.pendingAnimations,
            {
              from: { q: e.fromQ, r: e.fromR },
              to: { q: e.toQ, r: e.toR },
              path: e.path,
              userId: e.userId,
            },
          ],
        };
      }
      return { ...baseUpdate, animatingMove: newAnim };
    }),
  completeAnimation: () =>
    set((s) => {
      const [next, ...rest] = s.pendingAnimations;
      if (!next) return { animatingMove: null };
      return {
        animatingMove: {
          userId: next.userId,
          path: next.path,
          startedAt: performance.now(),
          duration: 400 * Math.max(1, next.path.length - 1),
        },
        pendingAnimations: rest,
      };
    }),
  setSelected: (h) => set({ selectedMarble: h, validDestinations: new Set() }),
  setCursor: (h) => set({ cursor: h }),
  setValidDestinations: (cells) =>
    set({ validDestinations: new Set(cells.map((c) => `${c.q},${c.r}`)) }),
  setIsSpectator: (v) => set({ isSpectator: v }),
  finishGame: (finishOrder) => set({ status: 'completed', finishOrder }),
  setTransientHighlight: (h) =>
    set({ transientHighlight: h ? { hex: h, startedAt: performance.now() } : null }),
  reset: () => set({ ...initial, board: new Map() }),
}));
