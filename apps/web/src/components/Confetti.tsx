import { useEffect, useRef } from 'react';

const COLORS = ['#FF5C5C', '#4F8FFF', '#3DD68C', '#FFD93D', '#B985FF', '#FF9F45'];

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rotation: number;
  vr: number;
  color: string;
  size: number;
  life: number;
};

/**
 * Pure-canvas confetti burst overlay. Renders fixed full-viewport, fires
 * a single burst on mount, then fades out and auto-unmounts via `onDone`.
 */
export function Confetti({ onDone }: { onDone?: () => void }): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const dpr = window.devicePixelRatio || 1;
    const w = window.innerWidth;
    const h = window.innerHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const N = 180;
    const particles: Particle[] = Array.from({ length: N }, () => ({
      x: w / 2 + (Math.random() - 0.5) * 100,
      y: h / 2,
      vx: (Math.random() - 0.5) * 12,
      vy: -Math.random() * 14 - 4,
      rotation: Math.random() * Math.PI * 2,
      vr: (Math.random() - 0.5) * 0.4,
      color: COLORS[Math.floor(Math.random() * COLORS.length)]!,
      size: 6 + Math.random() * 6,
      life: 1,
    }));

    let raf = 0;
    let start = performance.now();
    const DURATION = 3500;

    function frame(now: number): void {
      const elapsed = now - start;
      const t = Math.min(1, elapsed / DURATION);
      const alpha = Math.max(0, 1 - t);
      ctx.clearRect(0, 0, w, h);
      ctx.globalAlpha = alpha;
      for (const p of particles) {
        p.vy += 0.35; // gravity
        p.vx *= 0.995;
        p.x += p.vx;
        p.y += p.vy;
        p.rotation += p.vr;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        ctx.restore();
      }
      ctx.globalAlpha = 1;
      if (t < 1) {
        raf = requestAnimationFrame(frame);
      } else {
        onDone?.();
      }
    }
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [onDone]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="pointer-events-none fixed inset-0 z-50"
    />
  );
}
