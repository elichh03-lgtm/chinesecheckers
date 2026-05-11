import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '@/api/client';
import {
  HOME_TRIANGLES,
  PLAYER_HOME_POINTS,
  applyMove,
  key,
} from '@cc/game-engine';
import type { GameState, Hex, Marble, PlayerColor } from '@cc/shared-types';
import { render, type RenderState } from '@/components/board/BoardRenderer';

type GameApiResponse = {
  gameId: string;
  playerCount: 2 | 3 | 4 | 6;
  settings: { blockingRule?: boolean };
  startedAt: string | null;
  endedAt: string | null;
  players: Array<{
    userId: string;
    username: string;
    color: PlayerColor;
    homePoint: number;
    seatOrder: number;
    finishPos: number | null;
    eloDelta: number | null;
  }>;
  moves: Array<{
    moveNumber: number;
    userId: string | undefined;
    fromQ: number;
    fromR: number;
    toQ: number;
    toR: number;
    path: Hex[];
    isTimeout: boolean;
  }>;
};

function buildInitialBoard(g: GameApiResponse): GameState {
  const playerIds = [...g.players].sort((a, b) => a.seatOrder - b.seatOrder).map((p) => p.userId);
  const homePoints = PLAYER_HOME_POINTS[g.playerCount];
  const playerColors: Record<string, PlayerColor> = {};
  const playerHomePoint: Record<string, number> = {};
  const board = new Map<string, Marble | null>();
  for (const p of g.players) {
    playerColors[p.userId] = p.color;
    playerHomePoint[p.userId] = p.homePoint;
  }
  // Build empty board from all known cells
  // (engine's ALL_BOARD_CELLS isn't directly imported here — derive from triangles + center)
  // Easier path: use createInitialBoard from engine. But we need each player at their stored
  // homePoint, not a fresh assignment. Mirror the engine's structure manually.
  for (const tIdx of [0, 1, 2, 3, 4, 5]) {
    for (const cell of HOME_TRIANGLES[tIdx]!) board.set(key(cell), null);
  }
  // Center hex
  for (let q = -4; q <= 4; q++) {
    for (let r = -4; r <= 4; r++) {
      if (Math.abs(q + r) <= 4) board.set(`${q},${r}`, null);
    }
  }
  // Place marbles
  for (const p of g.players) {
    for (const cell of HOME_TRIANGLES[p.homePoint]!) {
      board.set(key(cell), { userId: p.userId, color: p.color });
    }
  }
  return {
    gameId: g.gameId,
    status: 'active',
    playerCount: g.playerCount,
    turnOrder: playerIds,
    currentTurnIndex: 0,
    moveCount: 0,
    timerEndsAt: 0,
    timeoutStrikes: Object.fromEntries(playerIds.map((id) => [id, 0])),
    finishedPlayers: [],
    board,
    playerColors,
    playerHomePoint,
    blockingRule: !!g.settings.blockingRule,
  };
  void homePoints;
}

export function Replay(): JSX.Element {
  const { gameId } = useParams<{ gameId: string }>();
  const navigate = useNavigate();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [data, setData] = useState<GameApiResponse | null>(null);
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!gameId) return;
    api
      .get<GameApiResponse>(`/games/${gameId}`)
      .then((r) => setData(r.data))
      .catch(() => navigate('/lobby'));
  }, [gameId, navigate]);

  const initialState = useMemo(() => (data ? buildInitialBoard(data) : null), [data]);

  // Apply moves up through `step` to compute the board state.
  const stepState = useMemo(() => {
    if (!initialState || !data) return null;
    let s: GameState = initialState;
    for (let i = 0; i < step; i++) {
      const m = data.moves[i]!;
      s = applyMove(s, {
        fromQ: m.fromQ,
        fromR: m.fromR,
        toQ: m.toQ,
        toR: m.toR,
        path: m.path,
      });
    }
    return s;
  }, [initialState, data, step]);

  // Auto-play
  useEffect(() => {
    if (!playing || !data) return;
    const id = setInterval(() => {
      setStep((s) => {
        if (s >= data.moves.length) {
          setPlaying(false);
          return s;
        }
        return s + 1;
      });
    }, 700);
    return () => clearInterval(id);
  }, [playing, data]);

  // Render loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !stepState || !data) return;
    const ctx = canvas.getContext('2d')!;
    const dpr = window.devicePixelRatio || 1;
    const container = containerRef.current!;
    const rect = container.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const size = Math.min(rect.width, rect.height) / 20;
    const origin = { x: rect.width / 2, y: rect.height / 2 };

    const homeAssignments: Record<number, string> = {};
    for (const p of data.players) homeAssignments[p.homePoint] = p.userId;

    const lastMove =
      step > 0
        ? {
            from: { q: data.moves[step - 1]!.fromQ, r: data.moves[step - 1]!.fromR },
            to: { q: data.moves[step - 1]!.toQ, r: data.moves[step - 1]!.toR },
          }
        : null;

    const rs: RenderState = {
      board: stepState.board,
      selected: null,
      validDestinations: new Set(),
      playerColors: stepState.playerColors,
      animatingMove: null,
      lastMove,
      homeAssignments,
      transientHighlight: null,
      now: performance.now(),
      size,
      origin,
    };
    render(ctx, rs);
  }, [stepState, data, step]);

  if (!data) {
    return <div className="min-h-screen bg-ink text-text p-8">Loading...</div>;
  }

  return (
    <div className="min-h-screen bg-ink flex flex-col">
      <header className="flex items-center justify-between p-4 border-b border-line">
        <button onClick={() => navigate('/lobby')} className="text-muted hover:text-text">
          ← Lobby
        </button>
        <div className="font-display font-semibold">Replay</div>
        <div className="text-muted text-sm">{data.gameId}</div>
      </header>

      <div className="flex-1 grid lg:grid-cols-[1fr_280px] gap-4 p-4">
        <div
          ref={containerRef}
          className="bg-canvas rounded-xl border border-line min-h-[60vh] lg:min-h-[600px] relative overflow-hidden"
        >
          <canvas ref={canvasRef} aria-label="Replay board" />
        </div>

        <aside className="bg-panel rounded-xl border border-line p-4 space-y-4">
          <div>
            <div className="text-xs uppercase tracking-wider text-muted mb-1">Move</div>
            <div className="text-2xl font-display font-semibold">
              {step} / {data.moves.length}
            </div>
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => setStep((s) => Math.max(0, s - 1))}
              disabled={step === 0}
              className="flex-1 bg-line text-text py-2 rounded-md disabled:opacity-40"
            >
              ←
            </button>
            <button
              onClick={() => setPlaying((p) => !p)}
              className="flex-1 bg-accent text-ink font-semibold py-2 rounded-md"
            >
              {playing ? 'Pause' : 'Play'}
            </button>
            <button
              onClick={() => setStep((s) => Math.min(data.moves.length, s + 1))}
              disabled={step >= data.moves.length}
              className="flex-1 bg-line text-text py-2 rounded-md disabled:opacity-40"
            >
              →
            </button>
          </div>

          <input
            type="range"
            min={0}
            max={data.moves.length}
            value={step}
            onChange={(e) => setStep(Number(e.target.value))}
            className="w-full"
            aria-label="Scrub timeline"
          />

          <div>
            <div className="text-xs uppercase tracking-wider text-muted mb-2">Players</div>
            <ol className="space-y-1 text-sm">
              {[...data.players]
                .sort((a, b) => (a.finishPos ?? 99) - (b.finishPos ?? 99))
                .map((p) => (
                  <li key={p.userId} className="flex items-center justify-between">
                    <span className="flex items-center gap-2">
                      <span
                        className="w-3 h-3 rounded-full"
                        style={{ background: colorOf(p.color) }}
                      />
                      {p.username}
                    </span>
                    {p.finishPos && (
                      <span className="text-muted">
                        #{p.finishPos}
                        {p.eloDelta !== null && ` (${p.eloDelta > 0 ? '+' : ''}${p.eloDelta})`}
                      </span>
                    )}
                  </li>
                ))}
            </ol>
          </div>
        </aside>
      </div>
    </div>
  );
}

function colorOf(c: string): string {
  const map: Record<string, string> = {
    red: '#FF5C5C',
    blue: '#4F8FFF',
    green: '#3DD68C',
    yellow: '#FFD93D',
    purple: '#B985FF',
    orange: '#FF9F45',
  };
  return map[c] ?? '#666';
}
