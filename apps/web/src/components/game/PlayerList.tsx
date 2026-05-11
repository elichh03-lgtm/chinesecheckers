import { Link } from 'react-router-dom';
import { useGameStore } from '@/stores/game';
import { useAuthStore } from '@/stores/auth';

const COLOR: Record<string, string> = {
  red: '#FF5C5C', blue: '#4F8FFF', green: '#3DD68C',
  yellow: '#FFD93D', purple: '#B985FF', orange: '#FF9F45',
};

export function PlayerList({
  usernames,
}: {
  usernames: Record<string, string>;
}): JSX.Element {
  const game = useGameStore();
  const auth = useAuthStore();

  return (
    <ul className="space-y-1.5">
      {game.turnOrder.map((uid) => {
        const isCurrent = uid === game.currentTurn;
        const color = game.playerColors[uid];
        const dot = color ? COLOR[color] : '#666';
        const name = usernames[uid] ?? uid.slice(0, 6);
        const finished = game.finishOrder?.find((p) => p.userId === uid);
        return (
          <li
            key={uid}
            className={`flex items-center gap-2.5 px-2.5 py-1.5 rounded-md transition ${
              isCurrent && !finished
                ? 'bg-accent/15 ring-1 ring-accent/30'
                : ''
            }`}
          >
            <span
              className="w-3 h-3 rounded-full flex-shrink-0"
              style={{ background: dot, boxShadow: isCurrent ? `0 0 8px ${dot}` : undefined }}
              aria-hidden
            />
            <Link
              to={`/profile/${name}`}
              className="text-sm flex-1 truncate hover:text-accent transition"
            >
              {name}
              {uid === auth.userId && <span className="text-muted ml-1">(you)</span>}
            </Link>
            {finished && (
              <span className="text-xs text-muted">#{finished.finishPos}</span>
            )}
            {!finished && isCurrent && (
              <span className="text-[10px] uppercase tracking-wider text-accent font-semibold">
                turn
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
