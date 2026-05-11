import { useEffect, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { api } from '@/api/client';
import { useAuthStore } from '@/stores/auth';
import { DeleteAccountModal } from '@/components/ui/DeleteAccountModal';
import { listSessions, revokeSession, type SessionRow } from '@/api/sessions';

type ProfileResponse = {
  id: string;
  username: string;
  avatarUrl: string | null;
  createdAt: string;
  eloRatings: Array<{
    mode: string;
    rating: number;
    gamesPlayed: number;
    wins: number;
    losses: number;
  }>;
};

type GameRow = {
  gameId: string;
  playerCount: number;
  mode: string;
  endedAt: string;
  finishPos: number | null;
  eloDelta: number | null;
};

export function Profile(): JSX.Element {
  const { username } = useParams<{ username: string }>();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<ProfileResponse | null>(null);
  const [games, setGames] = useState<GameRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [showDelete, setShowDelete] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [sessions, setSessions] = useState<SessionRow[] | null>(null);
  const [sessionsErr, setSessionsErr] = useState<string | null>(null);
  const authUsername = useAuthStore((s) => s.username);
  const logout = useAuthStore((s) => s.logout);
  const isOwnProfile = !!authUsername && authUsername === username;

  async function loadSessions(): Promise<void> {
    try {
      setSessions(await listSessions());
      setSessionsErr(null);
    } catch {
      setSessionsErr('Could not load sessions.');
    }
  }

  async function handleRevoke(id: string): Promise<void> {
    if (!window.confirm('Revoke this session? The other browser will be logged out at its next refresh.')) {
      return;
    }
    await revokeSession(id);
    await loadSessions();
  }

  async function handleExport(): Promise<void> {
    setExporting(true);
    try {
      const res = await api.get('/me/export', { responseType: 'blob' });
      const url = URL.createObjectURL(res.data as Blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `cc-data-${profile?.id ?? 'me'}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }

  useEffect(() => {
    if (!username) return;
    Promise.all([
      api.get<ProfileResponse>(`/users/${username}`),
      api.get<{ games: GameRow[] }>(`/users/${username}/games`),
    ])
      .then(([u, g]) => {
        setProfile(u.data);
        setGames(g.data.games);
      })
      .catch(() => setErr('User not found'));
  }, [username]);

  useEffect(() => {
    if (!isOwnProfile) {
      setSessions(null);
      return;
    }
    void loadSessions();
  }, [isOwnProfile]);

  if (err) {
    return (
      <div className="min-h-screen bg-ink text-text p-8 text-center">
        <p>{err}</p>
        <button
          onClick={() => navigate('/lobby')}
          className="mt-4 text-accent hover:underline"
        >
          Back to lobby
        </button>
      </div>
    );
  }
  if (!profile) {
    return (
      <div className="min-h-screen bg-ink p-8">
        <div className="max-w-3xl mx-auto space-y-6 animate-pulse-soft">
          <div className="skeleton h-8 w-48" />
          <div className="skeleton h-32 w-full rounded-xl" />
          <div className="skeleton h-48 w-full rounded-xl" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-ink p-8">
      <div className="max-w-3xl mx-auto">
        <header className="flex items-center justify-between mb-6">
          <button onClick={() => navigate('/lobby')} className="text-muted hover:text-text">
            ← Lobby
          </button>
          <Link to="/leaderboard" className="text-muted hover:text-text text-sm">
            Leaderboard →
          </Link>
        </header>

        <div className="bg-panel rounded-xl border border-line p-6 mb-6 flex items-start gap-4">
          {profile.avatarUrl ? (
            <img
              src={profile.avatarUrl}
              alt="avatar"
              className="w-16 h-16 rounded-full object-cover border border-line"
            />
          ) : (
            <div className="w-16 h-16 rounded-full bg-canvas border border-line flex items-center justify-center text-2xl text-muted">
              @
            </div>
          )}
          <div className="flex-1">
            <h1 className="font-display text-3xl font-bold">@{profile.username}</h1>
            <p className="text-muted text-sm mt-1">
              Joined {new Date(profile.createdAt).toLocaleDateString()}
            </p>
          </div>
          {isOwnProfile && (
            <Link
              to="/profile/edit"
              data-testid="edit-profile-link"
              className="text-sm text-accent hover:underline"
            >
              Edit profile
            </Link>
          )}
        </div>

        <section className="bg-panel rounded-xl border border-line p-6 mb-6">
          <h2 className="font-semibold mb-4">Ratings</h2>
          {profile.eloRatings.length === 0 ? (
            <p className="text-muted text-sm">No ranked games yet.</p>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              {profile.eloRatings.map((r) => (
                <div key={r.mode} className="bg-canvas rounded-md p-4">
                  <div className="text-xs uppercase tracking-wider text-muted">{r.mode}</div>
                  <div className="text-3xl font-display font-bold">{r.rating}</div>
                  <div className="text-xs text-muted mt-1">
                    {r.wins}W · {r.losses}L · {r.gamesPlayed} games
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {isOwnProfile && (
          <section className="bg-panel rounded-xl border border-line p-6 mb-6">
            <h2 className="font-semibold mb-2">Active sessions</h2>
            <p className="text-sm text-muted mb-4">
              Browsers signed in to your account. Revoke any you don&apos;t recognize.
            </p>
            {sessionsErr && <p className="text-red text-sm mb-2">{sessionsErr}</p>}
            {sessions === null ? (
              <p className="text-muted text-sm">Loading…</p>
            ) : sessions.length === 0 ? (
              <p className="text-muted text-sm">No active sessions.</p>
            ) : (
              <ul className="divide-y divide-line">
                {sessions.map((s) => (
                  <li
                    key={s.id}
                    data-testid={`session-row-${s.id}`}
                    className="py-3 flex items-center justify-between text-sm"
                  >
                    <span className="flex flex-col">
                      <span>
                        Signed in {new Date(s.createdAt).toLocaleString()}
                        {s.current && (
                          <span className="ml-2 text-xs uppercase tracking-wider text-accent">
                            this browser
                          </span>
                        )}
                      </span>
                      <span className="text-xs text-muted">
                        Last used{' '}
                        {s.lastUsedAt
                          ? new Date(s.lastUsedAt).toLocaleString()
                          : 'never'}
                      </span>
                    </span>
                    <button
                      onClick={() => void handleRevoke(s.id)}
                      className="px-3 py-1.5 text-xs text-red border border-red/40 rounded-md hover:bg-red/10"
                    >
                      Revoke
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {isOwnProfile && (
          <section className="bg-panel rounded-xl border border-line p-6 mb-6">
            <h2 className="font-semibold mb-2">Data & privacy</h2>
            <p className="text-sm text-muted mb-4">
              Download a copy of your data or permanently delete your account.
            </p>
            <div className="flex gap-3">
              <button
                onClick={handleExport}
                disabled={exporting}
                className="px-4 py-2 text-sm bg-canvas border border-line rounded-md hover:border-accent disabled:opacity-50"
              >
                {exporting ? 'Preparing…' : 'Download my data'}
              </button>
              <button
                onClick={() => setShowDelete(true)}
                className="px-4 py-2 text-sm text-red border border-red/40 rounded-md hover:bg-red/10"
              >
                Delete account
              </button>
            </div>
          </section>
        )}

        <section className="bg-panel rounded-xl border border-line p-6">
          <h2 className="font-semibold mb-4">Recent games</h2>
          {games.length === 0 ? (
            <p className="text-muted text-sm">No completed games yet.</p>
          ) : (
            <ul className="divide-y divide-line">
              {games.map((g) => (
                <li
                  key={g.gameId}
                  className="py-3 flex items-center justify-between text-sm"
                >
                  <Link
                    to={`/replay/${g.gameId}`}
                    className="hover:text-accent"
                  >
                    {g.playerCount}P · {new Date(g.endedAt).toLocaleString()}
                  </Link>
                  <span className="flex items-center gap-3">
                    {g.finishPos === 1 && <span className="text-green">Won</span>}
                    {g.finishPos !== 1 && (
                      <span className="text-muted">#{g.finishPos}</span>
                    )}
                    {g.eloDelta !== null && (
                      <span
                        className={
                          g.eloDelta > 0
                            ? 'text-green'
                            : g.eloDelta < 0
                              ? 'text-red'
                              : 'text-muted'
                        }
                      >
                        {g.eloDelta > 0 ? '+' : ''}
                        {g.eloDelta}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {showDelete && (
        <DeleteAccountModal
          onCancel={() => setShowDelete(false)}
          onDeleted={() => {
            logout();
            navigate('/');
          }}
        />
      )}
    </div>
  );
}
