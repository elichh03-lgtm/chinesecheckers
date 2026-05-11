import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '@/api/client';

type Row = {
  rank: number;
  username: string;
  rating: number;
  gamesPlayed: number;
  wins: number;
  losses: number;
};

export function Leaderboard(): JSX.Element {
  const navigate = useNavigate();
  const [mode, setMode] = useState<'2p' | 'multi'>('2p');
  const [rows, setRows] = useState<Row[]>([]);

  useEffect(() => {
    api.get<{ rows: Row[] }>(`/leaderboard?mode=${mode}`).then((r) => setRows(r.data.rows));
  }, [mode]);

  return (
    <div className="min-h-screen bg-ink p-8">
      <div className="max-w-3xl mx-auto">
        <header className="flex items-center justify-between mb-6">
          <button onClick={() => navigate('/lobby')} className="text-muted hover:text-text">
            ← Lobby
          </button>
          <h1 className="font-display text-2xl font-bold">Leaderboard</h1>
          <div className="w-16" />
        </header>

        <div className="flex gap-2 mb-4">
          {(['2p', 'multi'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`px-4 py-2 rounded-md text-sm ${
                mode === m
                  ? 'bg-accent text-ink font-semibold'
                  : 'bg-panel text-muted hover:text-text'
              }`}
            >
              {m === '2p' ? '2-Player' : 'Multiplayer'}
            </button>
          ))}
        </div>

        <div className="bg-panel rounded-xl border border-line overflow-hidden">
          {rows.length === 0 ? (
            <div className="p-8 text-center text-muted">No rated games yet.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-canvas text-muted">
                <tr>
                  <th className="text-left p-3">#</th>
                  <th className="text-left p-3">Player</th>
                  <th className="text-right p-3">Rating</th>
                  <th className="text-right p-3 hidden sm:table-cell">W/L</th>
                  <th className="text-right p-3 hidden sm:table-cell">Games</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((r) => (
                  <tr key={r.username}>
                    <td className="p-3 text-muted">{r.rank}</td>
                    <td className="p-3">
                      <Link to={`/profile/${r.username}`} className="hover:text-accent">
                        @{r.username}
                      </Link>
                    </td>
                    <td className="p-3 text-right font-display font-semibold">{r.rating}</td>
                    <td className="p-3 text-right text-muted hidden sm:table-cell">
                      {r.wins}/{r.losses}
                    </td>
                    <td className="p-3 text-right text-muted hidden sm:table-cell">
                      {r.gamesPlayed}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
