import type { Hex } from '@cc/shared-types';

export const HEX_DIRECTIONS: ReadonlyArray<Hex> = [
  { q: 1, r: 0 },
  { q: -1, r: 0 },
  { q: 0, r: 1 },
  { q: 0, r: -1 },
  { q: 1, r: -1 },
  { q: -1, r: 1 },
];

export const key = (h: Hex): string => `${h.q},${h.r}`;

export const parseKey = (k: string): Hex => {
  const [q, r] = k.split(',').map(Number);
  return { q: q as number, r: r as number };
};

export const hexEquals = (a: Hex, b: Hex): boolean => a.q === b.q && a.r === b.r;

export const hexAdd = (a: Hex, b: Hex): Hex => ({ q: a.q + b.q, r: a.r + b.r });
export const hexSub = (a: Hex, b: Hex): Hex => ({ q: a.q - b.q, r: a.r - b.r });
export const hexScale = (a: Hex, k: number): Hex => ({ q: a.q * k, r: a.r * k });

export const hexDistance = (a: Hex, b: Hex): number =>
  (Math.abs(a.q - b.q) + Math.abs(a.q + a.r - b.q - b.r) + Math.abs(a.r - b.r)) / 2;

// 60° clockwise rotation around origin in axial coords
export const rotateCW = (h: Hex): Hex => ({ q: -h.r, r: h.q + h.r });

// ────────────────────────── Sternhalma Board ──────────────────────────
// Center hexagon: max(|q|,|r|,|q+r|) <= 4 → 61 cells.
// Six home triangles (10 cells each), apexes at directions rotated 60° from
// the top (point 0) apex at (4, -8). Total 61 + 60 = 121.

const TOP_TRIANGLE_CELLS: Hex[] = [
  { q: 4, r: -8 },
  { q: 3, r: -7 }, { q: 4, r: -7 },
  { q: 2, r: -6 }, { q: 3, r: -6 }, { q: 4, r: -6 },
  { q: 1, r: -5 }, { q: 2, r: -5 }, { q: 3, r: -5 }, { q: 4, r: -5 },
];

function rotateCells(cells: Hex[], times: number): Hex[] {
  return cells.map((c) => {
    let h: Hex = { q: c.q, r: c.r };
    for (let i = 0; i < times; i++) h = rotateCW(h);
    return h;
  });
}

// Triangle k = top triangle rotated k * 60° clockwise.
// Point 0 = top, 1 = top-right, 2 = bottom-right, 3 = bottom, 4 = bottom-left, 5 = top-left
export const HOME_TRIANGLES: Hex[][] = [0, 1, 2, 3, 4, 5].map((k) =>
  rotateCells(TOP_TRIANGLE_CELLS, k),
);

function buildCenterHex(): Hex[] {
  const cells: Hex[] = [];
  for (let q = -4; q <= 4; q++) {
    for (let r = -4; r <= 4; r++) {
      if (Math.abs(q + r) <= 4) cells.push({ q, r });
    }
  }
  return cells;
}

const CENTER_HEX_CELLS = buildCenterHex();

export const ALL_BOARD_CELLS: Hex[] = [
  ...CENTER_HEX_CELLS,
  ...HOME_TRIANGLES.flat(),
];

export const BOARD_CELL_KEYS: ReadonlySet<string> = new Set(ALL_BOARD_CELLS.map(key));

export const isBoardCell = (h: Hex): boolean => BOARD_CELL_KEYS.has(key(h));

// Player count → which triangle indices are used (in turn order)
export const PLAYER_HOME_POINTS: Record<2 | 3 | 4 | 6, number[]> = {
  2: [0, 3],
  3: [0, 2, 4],
  4: [0, 1, 3, 4],
  6: [0, 1, 2, 3, 4, 5],
};

// A player's target triangle is the opposite point: (homePoint + 3) % 6.
export const opposingPoint = (point: number): number => (point + 3) % 6;
