// Pointy-top hex pixel <-> axial conversion.
// Match game-engine board.ts conventions.
import type { Hex } from '@cc/shared-types';

export type Pixel = { x: number; y: number };

const SQRT3 = Math.sqrt(3);

export function hexToPixel(h: Hex, size: number, origin: Pixel): Pixel {
  return {
    x: origin.x + size * SQRT3 * (h.q + h.r / 2),
    y: origin.y + size * 1.5 * h.r,
  };
}

export function pixelToHex(p: Pixel, size: number, origin: Pixel): Hex {
  const px = (p.x - origin.x) / size;
  const py = (p.y - origin.y) / size;
  const q = (SQRT3 / 3) * px - (1 / 3) * py;
  const r = (2 / 3) * py;
  return hexRound(q, r);
}

function hexRound(q: number, r: number): Hex {
  const s = -q - r;
  let rq = Math.round(q);
  let rr = Math.round(r);
  const rs = Math.round(s);
  const dq = Math.abs(rq - q);
  const dr = Math.abs(rr - r);
  const ds = Math.abs(rs - s);
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;
  return { q: rq, r: rr };
}
