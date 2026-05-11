import { useEffect, useRef } from 'react';
import { useGameStore } from '@/stores/game';
import { useAuthStore } from '@/stores/auth';

const COLOR: Record<string, string> = {
  red: '#FF5C5C', blue: '#4F8FFF', green: '#3DD68C',
  yellow: '#FFD93D', purple: '#B985FF', orange: '#FF9F45',
};

export function MoveHistory(): JSX.Element {
  const history = useGameStore((s) => s.moveHistory);
  const colors = useGameStore((s) => s.playerColors);
  const setSelected = useGameStore((s) => s.setSelected);
  const setTransientHighlight = useGameStore((s) => s.setTransientHighlight);
  const auth = useAuthStore();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight, behavior: 'smooth' });
  }, [history]);

  return (
    <div ref={ref} className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-1 text-xs font-mono">
      {history.length === 0 ? (
        <div className="text-muted text-center py-6 font-sans">No moves yet.</div>
      ) : (
        history.map((m, i) => {
          const color = colors[m.userId];
          const dot = color ? COLOR[color] : '#666';
          const isMe = m.userId === auth.userId;
          return (
            <button
              key={i}
              type="button"
              data-testid={`history-move-${i}`}
              onClick={() => {
                setSelected(m.from);
                setTransientHighlight(m.to);
              }}
              className={`w-full text-left flex items-center gap-2 px-2 py-1 rounded hover:bg-line/40 transition ${isMe ? 'bg-accent/10' : ''}`}
            >
              <span className="text-muted w-6 text-right">{i + 1}</span>
              <span
                className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                style={{ background: dot }}
              />
              <span className="text-text">
                ({m.from.q},{m.from.r})→({m.to.q},{m.to.r})
              </span>
              {m.pathLength > 1 && (
                <span className="text-muted ml-auto">×{m.pathLength}</span>
              )}
            </button>
          );
        })
      )}
    </div>
  );
}
