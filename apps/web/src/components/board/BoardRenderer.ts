import { ALL_BOARD_CELLS, HOME_TRIANGLES, key, parseKey } from '@cc/game-engine';
import type { Hex, Marble, PlayerColor } from '@cc/shared-types';
import { hexToPixel, type Pixel } from './hexMath';

const COLOR_HEX: Record<PlayerColor, string> = {
  red: '#FF5C5C',
  blue: '#4F8FFF',
  green: '#3DD68C',
  yellow: '#FFD93D',
  purple: '#B985FF',
  orange: '#FF9F45',
};

const HOME_TINTS: Record<number, PlayerColor> = {
  0: 'red', 1: 'blue', 2: 'green', 3: 'yellow', 4: 'purple', 5: 'orange',
};

export type RenderState = {
  board: Map<string, Marble | null>;
  selected: Hex | null;
  cursor?: Hex | null;
  validDestinations: Set<string>;
  playerColors: Record<string, PlayerColor>;
  animatingMove: {
    userId: string;
    path: Hex[];
    startedAt: number;
    duration: number;
  } | null;
  lastMove: { from: Hex; to: Hex } | null;
  homeAssignments: Record<number, string>; // point index → userId (for tinting active homes)
  transientHighlight: { hex: Hex; startedAt: number } | null;
  now: number;
  size: number;
  origin: Pixel;
};

const TRANSIENT_DURATION = 1200;

export function render(ctx: CanvasRenderingContext2D, state: RenderState): void {
  const { size, origin } = state;
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

  // Background
  ctx.fillStyle = '#1A1D26';
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

  // Home zone tints
  for (const [pointStr, userId] of Object.entries(state.homeAssignments)) {
    const point = Number(pointStr);
    const color = COLOR_HEX[HOME_TINTS[point]!];
    ctx.fillStyle = color + '26'; // ~15% alpha
    for (const cell of HOME_TRIANGLES[point]!) {
      const p = hexToPixel(cell, size, origin);
      drawHexCell(ctx, p, size * 0.95);
      ctx.fill();
    }
    void userId;
  }

  // Holes
  for (const cell of ALL_BOARD_CELLS) {
    const p = hexToPixel(cell, size, origin);
    ctx.beginPath();
    ctx.arc(p.x, p.y, size * 0.32, 0, Math.PI * 2);
    ctx.fillStyle = '#3A4150';
    ctx.fill();
    ctx.strokeStyle = '#252A36';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  // Valid destination overlays (pulsing dots)
  if (state.validDestinations.size > 0) {
    const pulse = 0.5 + 0.5 * Math.sin(state.now / 200);
    for (const k of state.validDestinations) {
      const cell = parseKey(k);
      const p = hexToPixel(cell, size, origin);
      ctx.beginPath();
      ctx.arc(p.x, p.y, size * 0.3 * pulse, 0, Math.PI * 2);
      ctx.fillStyle = '#7B8FFF80';
      ctx.fill();
    }
  }

  // Last-move flash
  if (state.lastMove) {
    const fromP = hexToPixel(state.lastMove.from, size, origin);
    const toP = hexToPixel(state.lastMove.to, size, origin);
    ctx.strokeStyle = '#FFFFFF60';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(fromP.x, fromP.y);
    ctx.lineTo(toP.x, toP.y);
    ctx.stroke();
  }

  // Marbles (skipping the animating one — drawn last)
  let animatingCell: string | null = null;
  if (state.animatingMove) {
    const m = state.animatingMove;
    const lastCell = m.path[m.path.length - 1]!;
    animatingCell = key(lastCell);
  }

  for (const [k, marble] of state.board) {
    if (!marble) continue;
    if (k === animatingCell) continue; // drawn separately
    const cell = parseKey(k);
    drawMarble(ctx, hexToPixel(cell, size, origin), size * 0.42, COLOR_HEX[marble.color]);
  }

  // Keyboard cursor (drawn beneath the selection ring so a selected marble
  // shows both indicators).
  if (state.cursor) {
    const p = hexToPixel(state.cursor, size, origin);
    ctx.beginPath();
    ctx.arc(p.x, p.y, size * 0.58, 0, Math.PI * 2);
    ctx.strokeStyle = '#FFFFFF80';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Transient highlight (move-history click flash)
  if (state.transientHighlight) {
    const elapsed = state.now - state.transientHighlight.startedAt;
    if (elapsed < TRANSIENT_DURATION) {
      const t = 1 - elapsed / TRANSIENT_DURATION;
      const p = hexToPixel(state.transientHighlight.hex, state.size, state.origin);
      ctx.beginPath();
      ctx.arc(p.x, p.y, size * (0.55 + 0.1 * (1 - t)), 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255, 217, 61, ${0.9 * t})`;
      ctx.lineWidth = 3;
      ctx.stroke();
    }
  }

  // Selection ring
  if (state.selected) {
    const p = hexToPixel(state.selected, size, origin);
    ctx.beginPath();
    const ringR = size * 0.5 + 2 * Math.sin(state.now / 160);
    ctx.arc(p.x, p.y, ringR, 0, Math.PI * 2);
    ctx.strokeStyle = '#7B8FFF';
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  // Animating marble
  if (state.animatingMove) {
    const m = state.animatingMove;
    const elapsed = state.now - m.startedAt;
    const t = Math.min(1, elapsed / m.duration);
    const segCount = m.path.length - 1;
    const segIdx = Math.min(segCount - 1, Math.floor(t * segCount));
    const localT = t * segCount - segIdx;
    const a = m.path[segIdx]!;
    const b = m.path[segIdx + 1]!;
    const pa = hexToPixel(a, size, origin);
    const pb = hexToPixel(b, size, origin);
    const ease = 0.5 - 0.5 * Math.cos(localT * Math.PI);
    const x = pa.x + (pb.x - pa.x) * ease;
    const y = pa.y + (pb.y - pa.y) * ease - 20 * Math.sin(localT * Math.PI); // arc up
    const lastCell = m.path[m.path.length - 1]!;
    const lastKey = key(lastCell);
    const marble = state.board.get(lastKey);
    if (marble) {
      drawMarble(ctx, { x, y }, size * 0.42, COLOR_HEX[marble.color]);
    }
  }
}

function drawHexCell(ctx: CanvasRenderingContext2D, center: Pixel, radius: number): void {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i + 30);
    const x = center.x + radius * Math.cos(angle);
    const y = center.y + radius * Math.sin(angle);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function drawMarble(ctx: CanvasRenderingContext2D, p: Pixel, radius: number, color: string): void {
  const grad = ctx.createRadialGradient(
    p.x - radius * 0.3, p.y - radius * 0.3, radius * 0.1,
    p.x, p.y, radius,
  );
  grad.addColorStop(0, '#FFFFFF');
  grad.addColorStop(0.2, color);
  grad.addColorStop(1, shade(color, -0.3));
  ctx.beginPath();
  ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.strokeStyle = shade(color, -0.5);
  ctx.lineWidth = 1;
  ctx.stroke();
}

function shade(hex: string, amt: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const adj = (v: number) => Math.max(0, Math.min(255, Math.round(v + v * amt)));
  return `rgb(${adj(r)}, ${adj(g)}, ${adj(b)})`;
}
