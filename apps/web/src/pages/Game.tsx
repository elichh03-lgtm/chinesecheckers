import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { GameBoard } from '@/components/board/GameBoard';
import { Confetti } from '@/components/Confetti';
import { ChatPanel } from '@/components/game/ChatPanel';
import { MoveHistory } from '@/components/game/MoveHistory';
import { PlayerList } from '@/components/game/PlayerList';
import { RingTimer } from '@/components/game/RingTimer';
import { useAuthStore } from '@/stores/auth';
import { useGameStore } from '@/stores/game';
import { getSocket } from '@/socket/client';
import { SOCKET_EVENTS } from '@cc/shared-types';
import { toast } from '@/stores/toast';
import { getMuted, setMuted, subscribe as subscribeSound } from '@/lib/sound';
import { getAnnounceMoves, setAnnounceMoves, subscribeSettings } from '@/lib/settings';

export function Game(): JSX.Element {
  const { gameId } = useParams<{ gameId: string }>();
  const [search] = useSearchParams();
  const watchOnly = search.get('watch') === '1';
  const auth = useAuthStore();
  const navigate = useNavigate();
  const game = useGameStore();
  const [tab, setTab] = useState<'players' | 'history' | 'chat'>('players');
  const [drawerOpen, setDrawerOpen] = useState(true);
  const [waitingMsg, setWaitingMsg] = useState<string>('Connecting...');
  const [roomState, setRoomState] = useState<{
    name: string;
    players: Array<{ userId: string; username: string }>;
    hostUserId: string;
    playerCount: number;
    timer: number;
    status: string;
  } | null>(null);

  // Build a userId → username lookup that survives game start (game store
  // doesn't carry usernames; we get them from room:state).
  const usernames: Record<string, string> = {};
  if (roomState) for (const p of roomState.players) usernames[p.userId] = p.username;

  useEffect(() => {
    if (!auth.token) {
      navigate('/');
      return;
    }
    if (!gameId) return;
    const sock = getSocket(auth.token);
    sock.emit(
      SOCKET_EVENTS.ROOM_JOIN,
      { gameId, token: auth.token, asSpectator: watchOnly },
      (res: any) => {
        if (res?.error) setWaitingMsg(`Failed to join: ${res.error}`);
      },
    );
    function onState(state: any): void {
      setRoomState(state);
      if (state.status === 'waiting') {
        setWaitingMsg(`Waiting for players... (${state.players.length}/${state.playerCount})`);
      }
      const iAmPlayer = state.players?.some((p: any) => p.userId === auth.userId);
      useGameStore.getState().setIsSpectator(!iAmPlayer);
    }
    function onRejected(e: any): void {
      const reason = e?.reason ?? 'unknown';
      const friendly: Record<string, string> = {
        NOT_YOUR_TURN: "Hold up — it's not your turn.",
        NO_MARBLE: 'No marble there.',
        WRONG_OWNER: 'That marble is not yours.',
        INVALID_DESTINATION: 'Invalid destination.',
        BLOCKED: 'Move would land in your target zone.',
        PATH_INVALID: 'That move is not valid.',
        REVISITED_HOP: 'You already visited that hex.',
      };
      toast.warn(friendly[reason] ?? `Move rejected: ${reason}`);
    }
    sock.on('room:state', onState);
    sock.on(SOCKET_EVENTS.GAME_MOVE_REJECTED, onRejected);
    return () => {
      sock.off('room:state', onState);
      sock.off(SOCKET_EVENTS.GAME_MOVE_REJECTED, onRejected);
    };
  }, [auth.token, gameId, navigate, watchOnly]);

  const isMyTurn = game.currentTurn === auth.userId;
  const winner = game.finishOrder?.find((p) => p.finishPos === 1);
  const iWon = !!winner && winner.userId === auth.userId;
  const myFinishEntry = game.finishOrder?.find((p) => p.userId === auth.userId);
  const currentColor = game.currentTurn ? game.playerColors[game.currentTurn] : undefined;

  function onResign(): void {
    if (!auth.token) return;
    const sock = getSocket(auth.token);
    sock.emit(SOCKET_EVENTS.GAME_RESIGN);
    toast.info('You resigned.');
  }

  return (
    <div className="min-h-screen bg-ink flex flex-col">
      {iWon && <Confetti />}

      <header className="bg-ink/80 backdrop-blur border-b border-line">
        <div className="px-4 py-3 flex items-center justify-between">
          <button
            onClick={() => navigate('/lobby')}
            className="text-muted hover:text-text text-sm flex items-center gap-1"
          >
            ← Lobby
          </button>
          <div className="font-display font-semibold text-sm">
            {roomState?.name ?? 'Halma'}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted text-xs hidden sm:inline">@{auth.username}</span>
            <SettingsMenu />
          </div>
        </div>
      </header>

      <div className="flex-1 grid lg:grid-cols-[1fr_340px] gap-3 p-3 sm:p-4 max-w-[1400px] w-full mx-auto pb-[44vh] lg:pb-4">
        <div className="bg-panel rounded-xl border border-line p-3 sm:p-4 flex flex-col h-[70vh] lg:h-auto">
          {game.status === 'idle' || game.status === 'waiting' ? (
            <WaitingScreen
              msg={waitingMsg}
              roomState={roomState}
              userId={auth.userId}
              token={auth.token}
            />
          ) : (
            <div className="flex-1 min-h-[60vh] lg:min-h-[600px]">
              <GameBoard />
            </div>
          )}
        </div>

        <aside
          data-testid="game-sidebar"
          className={`bg-panel border-line flex flex-col overflow-hidden min-h-0 fixed bottom-0 left-0 right-0 z-20 border-t rounded-t-xl transition-[max-height] duration-200 ${
            drawerOpen ? 'max-h-[75vh]' : 'max-h-[44px]'
          } lg:static lg:rounded-xl lg:border lg:max-h-none lg:transition-none`}
        >
          <button
            type="button"
            data-testid="drawer-handle"
            onClick={() => setDrawerOpen((v) => !v)}
            aria-expanded={drawerOpen}
            aria-label={drawerOpen ? 'Collapse sidebar' : 'Expand sidebar'}
            className="lg:hidden w-full flex items-center justify-center py-2 border-b border-line"
          >
            <span className="w-10 h-1.5 rounded-full bg-line block" aria-hidden />
          </button>
          {/* Active game header: timer + turn */}
          {game.status === 'active' && !myFinishEntry && (
            <div className="p-4 border-b border-line">
              {game.isSpectator && (
                <div className="text-[10px] uppercase tracking-wider text-muted bg-line/50 rounded px-2 py-0.5 inline-block mb-3">
                  Spectating
                </div>
              )}
              <div className="flex items-center gap-4">
                <RingTimer
                  endsAt={game.timerEndsAt}
                  totalMs={(roomState?.timer ?? 60) * 1000}
                  playerColor={currentColor}
                />
                <div className="flex-1 min-w-0">
                  <div className="text-xs uppercase tracking-wider text-muted">Turn</div>
                  <div
                    data-testid="turn-indicator"
                    aria-live="polite"
                    aria-atomic="true"
                    className={`font-semibold text-lg ${isMyTurn ? 'text-green' : 'text-text'}`}
                  >
                    {game.isSpectator
                      ? `${shorten(usernames[game.currentTurn ?? ''] ?? game.currentTurn)} to move`
                      : isMyTurn
                        ? 'Your move'
                        : `Waiting on ${shorten(usernames[game.currentTurn ?? ''] ?? game.currentTurn)}`}
                  </div>
                  {!game.isSpectator && (
                    <button
                      onClick={onResign}
                      className="text-xs text-muted hover:text-red transition mt-2"
                    >
                      Resign
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Game over panel */}
          {game.status === 'completed' && game.finishOrder && (
            <GameOverPanel
              finishOrder={game.finishOrder}
              usernames={usernames}
              userId={auth.userId}
              gameId={gameId ?? null}
              navigate={navigate}
            />
          )}

          {/* Tabbed sidebar */}
          {game.status === 'active' && (
            <>
              <div className="flex border-b border-line text-xs">
                {(['players', 'history', 'chat'] as const).map((t) => (
                  <button
                    key={t}
                    data-testid={`tab-${t}`}
                    onClick={() => setTab(t)}
                    className={`flex-1 py-2.5 uppercase tracking-wider font-medium transition ${
                      tab === t
                        ? 'text-accent border-b-2 border-accent -mb-px'
                        : 'text-muted hover:text-text'
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
              <div className="flex-1 min-h-0 p-4 flex flex-col">
                {tab === 'players' && <PlayerList usernames={usernames} />}
                {tab === 'history' && <MoveHistory />}
                {tab === 'chat' && <ChatPanel />}
              </div>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}

function WaitingScreen({
  msg,
  roomState,
  userId,
  token,
}: {
  msg: string;
  roomState: {
    name: string;
    players: Array<{ userId: string; username: string }>;
    hostUserId: string;
    playerCount: number;
    timer: number;
    status: string;
  } | null;
  userId: string | null;
  token: string | null;
}): JSX.Element {
  const isHost = roomState?.hostUserId === userId;
  const canStart =
    isHost &&
    roomState?.status === 'waiting' &&
    roomState.players.length >= 2 &&
    [2, 3, 4, 6].includes(roomState.players.length) &&
    roomState.players.length < roomState.playerCount;

  function copyShareLink(): void {
    void navigator.clipboard.writeText(window.location.origin + window.location.pathname);
    toast.success('Link copied');
  }

  return (
    <div className="flex-1 flex flex-col items-center justify-center text-muted gap-6 py-12 animate-fade-in">
      <div className="relative">
        <div className="w-16 h-16 rounded-full border-4 border-accent/20 border-t-accent animate-spin" />
      </div>
      <div className="text-center">
        <div className="font-semibold text-text text-lg">{msg}</div>
        {roomState && roomState.status === 'waiting' && (
          <div className="text-xs mt-2">Share a link to invite others:</div>
        )}
      </div>
      {roomState && roomState.status === 'waiting' && (
        <button
          onClick={copyShareLink}
          className="bg-canvas hover:bg-line text-text text-sm px-4 py-2 rounded-md border border-line transition"
        >
          📋 Copy invite link
        </button>
      )}
      {roomState && roomState.players.length > 0 && (
        <ul className="space-y-1.5 text-sm">
          {roomState.players.map((p) => (
            <li key={p.userId} className="text-text">
              · @{p.username}
              {p.userId === roomState.hostUserId && (
                <span className="text-muted ml-1">(host)</span>
              )}
            </li>
          ))}
        </ul>
      )}
      {canStart && token && (
        <button
          data-testid="host-start-btn"
          onClick={() => {
            const sock = getSocket(token);
            sock.emit(SOCKET_EVENTS.GAME_START_REQUEST);
          }}
          className="bg-accent hover:bg-accent/90 text-ink font-semibold px-6 py-2.5 rounded-md transition shadow-sm"
        >
          Start now ({roomState!.players.length} players)
        </button>
      )}
    </div>
  );
}

function GameOverPanel({
  finishOrder,
  usernames,
  userId,
  gameId,
  navigate,
}: {
  finishOrder: Array<{ userId: string; finishPos: number; eloDelta: number }>;
  usernames: Record<string, string>;
  userId: string | null;
  gameId: string | null;
  navigate: (to: string) => void;
}): JSX.Element {
  const myEntry = finishOrder.find((p) => p.userId === userId);
  return (
    <div className="p-5 animate-slide-up">
      <h3 className="font-display text-xl font-bold mb-1">
        {myEntry?.finishPos === 1 ? '🏆 You won!' : myEntry ? `#${myEntry.finishPos}` : 'Game over'}
      </h3>
      <p className="text-xs text-muted mb-4">Final standings</p>
      <ol className="space-y-1.5 mb-5">
        {finishOrder.map((p) => {
          const sign = p.eloDelta > 0 ? '+' : '';
          const color =
            p.eloDelta > 0 ? 'text-green' : p.eloDelta < 0 ? 'text-red' : 'text-muted';
          const isMe = p.userId === userId;
          return (
            <li
              key={p.userId}
              className={`flex justify-between items-center text-sm rounded-md px-2.5 py-1.5 ${
                isMe ? 'bg-accent/10' : ''
              }`}
            >
              <span className="flex items-center gap-2">
                <span className="text-muted font-mono">#{p.finishPos}</span>
                <Link
                  to={`/profile/${usernames[p.userId] ?? p.userId}`}
                  className="hover:text-accent"
                >
                  {usernames[p.userId] ?? p.userId.slice(0, 6)}
                </Link>
                {isMe && <span className="text-muted text-xs">(you)</span>}
              </span>
              {p.eloDelta !== 0 && (
                <span className={`font-mono text-xs ${color}`}>
                  {sign}{p.eloDelta}
                </span>
              )}
            </li>
          );
        })}
      </ol>
      <div className="flex flex-col gap-2">
        {gameId && (
          <button
            onClick={() => navigate(`/replay/${gameId}`)}
            className="w-full bg-line hover:bg-line/80 text-text font-medium py-2 rounded-md transition"
          >
            View Replay
          </button>
        )}
        <button
          onClick={() => navigate('/lobby')}
          className="w-full bg-accent hover:bg-accent/90 text-ink font-semibold py-2 rounded-md transition shadow-sm"
        >
          Back to Lobby
        </button>
      </div>
    </div>
  );
}

function SettingsMenu(): JSX.Element {
  const [open, setOpen] = useState(false);
  const [muted, setMutedLocal] = useState(getMuted());
  const [announce, setAnnounceLocal] = useState(getAnnounceMoves());
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => subscribeSound(() => setMutedLocal(getMuted())), []);
  useEffect(() => subscribeSettings(() => setAnnounceLocal(getAnnounceMoves())), []);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent): void {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        data-testid="settings-btn"
        onClick={() => setOpen((v) => !v)}
        aria-label="Game settings"
        aria-expanded={open}
        className="p-1.5 rounded-md text-muted hover:text-text hover:bg-panel transition"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
          <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.6" />
          <path
            d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"
            stroke="currentColor"
            strokeWidth="1.4"
          />
        </svg>
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-60 bg-panel border border-line rounded-md shadow-lg p-3 z-30 text-sm">
          <label className="flex items-center justify-between gap-2 py-1.5 cursor-pointer">
            <span>Mute sound</span>
            <input
              data-testid="settings-mute"
              type="checkbox"
              checked={muted}
              onChange={(e) => setMuted(e.target.checked)}
              className="accent-accent"
            />
          </label>
          <label className="flex items-center justify-between gap-2 py-1.5 cursor-pointer">
            <span>Announce moves aloud</span>
            <input
              data-testid="settings-announce"
              type="checkbox"
              checked={announce}
              onChange={(e) => setAnnounceMoves(e.target.checked)}
              className="accent-accent"
            />
          </label>
        </div>
      )}
    </div>
  );
}

function shorten(uid: string | null | undefined): string {
  if (!uid) return '—';
  if (uid.length <= 12) return uid;
  return uid.slice(0, 8);
}
