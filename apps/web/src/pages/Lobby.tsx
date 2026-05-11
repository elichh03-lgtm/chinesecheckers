import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { useAuthStore } from '@/stores/auth';
import type { RoomSummary, PlayerCount } from '@cc/shared-types';
import { toast } from '@/stores/toast';
import { getMuted, setMuted, subscribe as subscribeSound } from '@/lib/sound';
import { SUPPORTED_LOCALES } from '@/i18n';

const PLAYER_COLORS_FOR_COUNT: Record<PlayerCount, string[]> = {
  2: ['#FF5C5C', '#FFD93D'],
  3: ['#FF5C5C', '#3DD68C', '#B985FF'],
  4: ['#FF5C5C', '#4F8FFF', '#FFD93D', '#B985FF'],
  6: ['#FF5C5C', '#4F8FFF', '#3DD68C', '#FFD93D', '#B985FF', '#FF9F45'],
};

export function Lobby(): JSX.Element {
  const { t } = useTranslation();
  const auth = useAuthStore();
  const navigate = useNavigate();
  const [rooms, setRooms] = useState<RoomSummary[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [playerCount, setPlayerCount] = useState<PlayerCount>(2);
  const [timer, setTimer] = useState(60);
  const [blockingRule, setBlockingRule] = useState(false);

  useEffect(() => {
    if (!auth.token) {
      navigate('/');
      return;
    }
    let alive = true;
    async function load(): Promise<void> {
      try {
        const { data } = await api.get('/rooms');
        if (alive) setRooms(data.rooms);
      } catch (e) {
        // intercepter handles 401
      }
    }
    load();
    const id = setInterval(load, 2000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [auth.token, navigate]);

  async function createRoom(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!auth.token) return;
    try {
      const { data } = await api.post('/rooms', {
        name: name.trim() || `${auth.username}'s game`,
        playerCount,
        timer,
        isPublic: true,
        allowSpectators: true,
        blockingRule,
        hostToken: auth.token,
      });
      navigate(`/game/${data.gameId}`);
    } catch {
      toast.error(t('lobby.createCouldNotCreate'));
    }
  }

  return (
    <div className="min-h-screen bg-ink">
      <header className="sticky top-0 z-10 bg-ink/80 backdrop-blur border-b border-line">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <Link to="/lobby" className="flex items-center gap-2">
            <Star className="w-5 h-5 text-accent" />
            <span className="font-display font-bold tracking-tight">Halma</span>
          </Link>
          <nav className="flex items-center gap-1 text-sm">
            <Link
              to="/leaderboard"
              className="px-3 py-1.5 rounded-md text-muted hover:text-text hover:bg-panel transition"
            >
              {t('common.leaderboard')}
            </Link>
            <LanguageSwitcher />
            <MuteToggle />
            {auth.username && (
              <Link
                to={`/profile/${auth.username}`}
                className="px-3 py-1.5 rounded-md text-muted hover:text-text hover:bg-panel transition"
              >
                @{auth.username}
              </Link>
            )}
            <button
              onClick={() => {
                auth.logout();
                navigate('/');
              }}
              className="px-3 py-1.5 rounded-md text-muted hover:text-text hover:bg-panel transition"
            >
              {t('common.signOut')}
            </button>
          </nav>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
        <div className="flex items-end justify-between mb-6 gap-4 flex-wrap">
          <div>
            <h1 className="font-display text-3xl sm:text-4xl font-bold tracking-tight">{t('lobby.title')}</h1>
            <p className="text-muted text-sm mt-1">{t('lobby.subtitle')}</p>
          </div>
          <button
            data-testid="new-room-btn"
            onClick={() => setCreating(true)}
            className="bg-accent hover:bg-accent/90 text-ink font-semibold px-5 py-2.5 rounded-md text-sm transition shadow-sm"
          >
            {t('lobby.newRoom')}
          </button>
        </div>

        <div className="grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            {rooms === null ? (
              <RoomsSkeleton />
            ) : rooms.length === 0 ? (
              <EmptyRooms onCreate={() => setCreating(true)} />
            ) : (
              <ul className="space-y-3 animate-fade-in">
                {rooms.map((r) => (
                  <RoomCard
                    key={r.gameId}
                    room={r}
                    onJoin={() => navigate(`/game/${r.gameId}`)}
                    onWatch={() => navigate(`/game/${r.gameId}?watch=1`)}
                  />
                ))}
              </ul>
            )}
          </div>

          {creating ? (
            <CreateRoomCard
              {...{ name, setName, playerCount, setPlayerCount, timer, setTimer, blockingRule, setBlockingRule }}
              onSubmit={createRoom}
              onCancel={() => setCreating(false)}
            />
          ) : (
            <SidebarTips />
          )}
        </div>
      </main>
    </div>
  );
}

function RoomCard({
  room,
  onJoin,
  onWatch,
}: {
  room: RoomSummary;
  onJoin: () => void;
  onWatch: () => void;
}): JSX.Element {
  const { t } = useTranslation();
  const filled = room.currentPlayers;
  const total = room.playerCount;
  const colors = PLAYER_COLORS_FOR_COUNT[total];
  const isFull = filled >= total;
  const isActive = room.status === 'active';

  return (
    <li
      data-testid={`room-row-${room.name}`}
      className="group bg-panel rounded-xl border border-line hover:border-accent/50 transition overflow-hidden"
    >
      <div className="w-full p-4 flex items-center gap-4">
        <button
          onClick={isActive ? onWatch : onJoin}
          className="flex items-center gap-4 flex-1 min-w-0 text-left"
        >
          {/* Player slots visualization */}
          <div className="flex -space-x-1.5 flex-shrink-0">
            {colors.map((c, i) => (
              <span
                key={i}
                className={`w-7 h-7 rounded-full border-2 border-panel ${i < filled ? '' : 'opacity-25'}`}
                style={{ background: c }}
                aria-hidden
              />
            ))}
          </div>

          <div className="flex-1 min-w-0">
            <div className="font-semibold truncate">{room.name}</div>
            <div className="text-xs text-muted mt-0.5 flex items-center gap-2 flex-wrap">
              <span>{t('lobby.byHost', { name: room.hostUsername })}</span>
              <span className="text-line">·</span>
              <span>{t('lobby.playersFraction', { filled, total })}</span>
              <span className="text-line">·</span>
              <span>{t('lobby.timerSeconds', { count: room.timer })}</span>
            </div>
          </div>
        </button>

        <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
          <StatusBadge status={room.status} />
          <div className="flex items-center gap-1.5">
            {!isActive && (
              <button
                data-testid={`watch-${room.name}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onWatch();
                }}
                className="text-[11px] px-2 py-1 rounded-md border border-line text-muted hover:text-accent hover:border-accent/50 transition"
              >
                {t('lobby.watch')}
              </button>
            )}
            <span className="text-xs text-muted group-hover:text-accent transition">
              {isActive ? t('lobby.watch') : isFull ? t('lobby.full') : t('lobby.join')} →
            </span>
          </div>
        </div>
      </div>
    </li>
  );
}

function StatusBadge({ status }: { status: string }): JSX.Element {
  const { t } = useTranslation();
  const map: Record<string, { bg: string; text: string; label: string }> = {
    waiting: { bg: 'bg-yellow/15', text: 'text-yellow', label: t('lobby.waiting') },
    active: { bg: 'bg-green/15', text: 'text-green', label: t('lobby.live') },
    completed: { bg: 'bg-line', text: 'text-muted', label: t('lobby.done') },
  };
  const s = map[status] ?? map.waiting!;
  return (
    <span className={`text-[10px] uppercase font-semibold tracking-wider px-2 py-0.5 rounded-full ${s.bg} ${s.text}`}>
      {s.label}
    </span>
  );
}

function RoomsSkeleton(): JSX.Element {
  return (
    <ul className="space-y-3">
      {[0, 1, 2].map((i) => (
        <li key={i} className="bg-panel rounded-xl border border-line p-4 flex items-center gap-4">
          <div className="flex -space-x-1.5">
            <span className="skeleton w-7 h-7 rounded-full" />
            <span className="skeleton w-7 h-7 rounded-full" />
          </div>
          <div className="flex-1 space-y-2">
            <div className="skeleton h-4 w-1/3" />
            <div className="skeleton h-3 w-1/2" />
          </div>
        </li>
      ))}
    </ul>
  );
}

function EmptyRooms({ onCreate }: { onCreate: () => void }): JSX.Element {
  const { t } = useTranslation();
  return (
    <div className="bg-panel rounded-xl border border-dashed border-line p-12 text-center animate-fade-in">
      <Star className="w-12 h-12 text-line mx-auto mb-3" />
      <p className="font-semibold text-text">{t('lobby.noRoomsTitle')}</p>
      <p className="text-sm text-muted mt-1">{t('lobby.noRoomsSubtitle')}</p>
      <button
        onClick={onCreate}
        className="mt-4 bg-accent text-ink font-semibold px-5 py-2 rounded-md text-sm hover:bg-accent/90 transition"
      >
        {t('lobby.newRoom')}
      </button>
    </div>
  );
}

function SidebarTips(): JSX.Element {
  const { t } = useTranslation();
  return (
    <aside className="bg-panel rounded-xl border border-line p-5 h-fit space-y-4 animate-fade-in">
      <div>
        <div className="text-xs uppercase tracking-wider text-muted mb-2">{t('lobby.howToPlayTitle')}</div>
        <ul className="text-sm space-y-2 text-text">
          {(['howToPlay1', 'howToPlay2', 'howToPlay3', 'howToPlay4'] as const).map((k) => (
            <li className="flex gap-2" key={k}>
              <span className="text-accent" aria-hidden>→</span>
              {t(`lobby.${k}`)}
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}

function CreateRoomCard(props: {
  name: string;
  setName: (v: string) => void;
  playerCount: PlayerCount;
  setPlayerCount: (v: PlayerCount) => void;
  timer: number;
  setTimer: (v: number) => void;
  blockingRule: boolean;
  setBlockingRule: (v: boolean) => void;
  onSubmit: (e: React.FormEvent) => void;
  onCancel: () => void;
}): JSX.Element {
  return (
    <form
      onSubmit={props.onSubmit}
      className="bg-panel rounded-xl border border-accent/30 p-5 space-y-4 h-fit animate-slide-up"
    >
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">New Room</h2>
        <button
          type="button"
          onClick={props.onCancel}
          className="text-muted hover:text-text text-sm"
          aria-label="Cancel"
        >
          ✕
        </button>
      </div>
      <div>
        <label className="block text-xs font-medium uppercase tracking-wider text-muted mb-1.5">Name</label>
        <input
          value={props.name}
          onChange={(e) => props.setName(e.target.value)}
          placeholder="My game"
          maxLength={50}
          className="w-full bg-canvas border border-line rounded-md px-3 py-2 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
        />
      </div>
      <div>
        <label className="block text-xs font-medium uppercase tracking-wider text-muted mb-1.5">Players</label>
        <div className="grid grid-cols-4 gap-1 p-1 bg-canvas rounded-md">
          {([2, 3, 4, 6] as const).map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => props.setPlayerCount(n)}
              className={`py-1.5 text-sm rounded transition ${
                props.playerCount === n
                  ? 'bg-accent text-ink font-semibold'
                  : 'text-muted hover:text-text'
              }`}
            >
              {n}
            </button>
          ))}
        </div>
      </div>
      <div>
        <label className="block text-xs font-medium uppercase tracking-wider text-muted mb-1.5">
          Turn timer · {props.timer}s
        </label>
        <input
          type="range"
          min={15}
          max={180}
          step={15}
          value={props.timer}
          onChange={(e) => props.setTimer(Number(e.target.value))}
          className="w-full accent-accent"
        />
        <div className="flex justify-between text-[10px] text-muted mt-1">
          <span>15s</span><span>60s</span><span>120s</span><span>180s</span>
        </div>
      </div>
      <label className="flex items-start gap-2.5 text-sm cursor-pointer group">
        <input
          type="checkbox"
          checked={props.blockingRule}
          onChange={(e) => props.setBlockingRule(e.target.checked)}
          className="mt-1 accent-accent"
        />
        <span>
          <span className="text-text font-medium">Blocking rule</span>
          <span className="block text-xs text-muted mt-0.5">
            Evict an enemy marble out of your target zone on your turn.
          </span>
        </span>
      </label>
      <div className="flex gap-2 pt-1">
        <button
          data-testid="create-room-submit"
          type="submit"
          className="flex-1 bg-accent hover:bg-accent/90 text-ink font-semibold py-2.5 rounded-md transition shadow-sm"
        >
          Create
        </button>
      </div>
    </form>
  );
}

function MuteToggle(): JSX.Element {
  const [muted, setLocal] = useState(getMuted());
  useEffect(() => subscribeSound(() => setLocal(getMuted())), []);
  return (
    <button
      data-testid="mute-toggle"
      aria-pressed={muted}
      aria-label={muted ? 'Unmute sound' : 'Mute sound'}
      title={muted ? 'Unmute sound' : 'Mute sound'}
      onClick={() => setMuted(!muted)}
      className="px-2 py-1.5 rounded-md text-muted hover:text-text hover:bg-panel transition"
    >
      {muted ? (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path
            d="M11 5 6 9H3v6h3l5 4V5Z M17 9l4 4M21 9l-4 4"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path
            d="M11 5 6 9H3v6h3l5 4V5Z M15.5 8.5a5 5 0 0 1 0 7 M18.5 5.5a9 9 0 0 1 0 13"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </button>
  );
}

function Star({ className }: { className?: string }): JSX.Element {
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden focusable="false">
      <polygon
        points="50,5 61.8,38.2 95,38.2 68.6,58.8 80.4,92 50,71.4 19.6,92 31.4,58.8 5,38.2 38.2,38.2"
        fill="currentColor"
      />
    </svg>
  );
}
