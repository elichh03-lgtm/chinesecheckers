import { useEffect, useState } from 'react';
import { playTick } from '@/lib/sound';

const COLOR: Record<string, string> = {
  red: '#FF5C5C', blue: '#4F8FFF', green: '#3DD68C',
  yellow: '#FFD93D', purple: '#B985FF', orange: '#FF9F45',
};

/**
 * Circular countdown ring. Color follows the active player's marble color
 * and shifts to red in the last 10 seconds.
 */
export function RingTimer({
  endsAt,
  totalMs,
  playerColor,
  size = 96,
  stroke = 6,
}: {
  endsAt: number;
  totalMs: number;
  playerColor?: string;
  size?: number;
  stroke?: number;
}): JSX.Element {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(id);
  }, []);

  const remaining = Math.max(0, endsAt - now);
  const seconds = Math.ceil(remaining / 1000);
  useEffect(() => {
    if (seconds <= 5 && seconds > 0) playTick(`${endsAt}`);
  }, [seconds, endsAt]);
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const t = Math.max(0, Math.min(1, remaining / totalMs));
  const offset = c * (1 - t);
  const danger = remaining <= 10_000;
  const reduceMotion =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const ringColor = danger ? '#FF5C5C' : (playerColor && COLOR[playerColor]) || '#7B8FFF';

  return (
    <div className="relative inline-flex items-center justify-center" aria-label={`${seconds} seconds remaining`}>
      <svg width={size} height={size} className={danger && !reduceMotion ? 'animate-pulse-soft' : ''}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="rgba(255,255,255,0.06)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={ringColor}
          strokeWidth={stroke}
          strokeDasharray={c}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: 'stroke-dashoffset 0.1s linear, stroke 0.4s' }}
        />
      </svg>
      <div className={`absolute font-display font-bold ${danger ? 'text-red' : 'text-text'}`}>
        <span className="text-2xl">{seconds}</span>
        <span className="text-xs text-muted ml-0.5">s</span>
      </div>
    </div>
  );
}
