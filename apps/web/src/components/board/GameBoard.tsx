import { useEffect, useRef } from 'react';
import { useGameStore } from '@/stores/game';
import { useAuthStore } from '@/stores/auth';
import { getAnnounceMoves } from '@/lib/settings';
import { render } from './BoardRenderer';
import { hexToPixel, pixelToHex, type Pixel } from './hexMath';
import { ALL_BOARD_CELLS, HEX_DIRECTIONS, HOME_TRIANGLES, hexAdd, isBoardCell, key, opposingPoint } from '@cc/game-engine';
import type { Hex } from '@cc/shared-types';
import { SOCKET_EVENTS } from '@cc/shared-types';
import { getSocket } from '@/socket/client';

export function GameBoard(): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const game = useGameStore();
  const auth = useAuthStore();

  // Draw loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    let running = true;

    function fitCanvas(): { size: number; origin: Pixel } {
      const container = containerRef.current!;
      const rect = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas!.width = rect.width * dpr;
      canvas!.height = rect.height * dpr;
      canvas!.style.width = `${rect.width}px`;
      canvas!.style.height = `${rect.height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // Compute size to fit board (~17 cells wide, 17 tall)
      const size = Math.min(rect.width, rect.height) / 20;
      const origin = { x: rect.width / 2, y: rect.height / 2 };
      return { size, origin };
    }

    function frame(): void {
      if (!running) return;
      const { size, origin } = fitCanvas();
      const s = useGameStore.getState();

      // Drain finished animation; pop the next pending one (if any).
      if (s.animatingMove) {
        const elapsed = performance.now() - s.animatingMove.startedAt;
        if (elapsed >= s.animatingMove.duration) {
          s.completeAnimation();
        }
      }

      // Build home assignments from playerColors / turnOrder for tinting
      const homeAssignments: Record<number, string> = {};
      const colorToPoint: Record<string, number> = {
        red: 0, blue: 1, green: 2, yellow: 3, purple: 4, orange: 5,
      };
      for (const [uid, color] of Object.entries(s.playerColors)) {
        homeAssignments[colorToPoint[color]!] = uid;
      }

      // Auto-clear transient highlight after its display duration.
      if (s.transientHighlight && performance.now() - s.transientHighlight.startedAt > 1200) {
        s.setTransientHighlight(null);
      }

      render(ctx, {
        board: s.board,
        selected: s.selectedMarble,
        cursor: s.cursor,
        validDestinations: s.validDestinations,
        playerColors: s.playerColors,
        animatingMove: s.animatingMove,
        lastMove: s.lastMove,
        homeAssignments,
        transientHighlight: s.transientHighlight,
        now: performance.now(),
        size,
        origin,
      });
      requestAnimationFrame(frame);
    }
    frame();

    const ro = new ResizeObserver(() => {
      // resize handled in next frame
    });
    if (containerRef.current) ro.observe(containerRef.current);

    return () => {
      running = false;
      ro.disconnect();
    };
  }, []);

  function activateHex(hex: Hex): void {
    if (!auth.token) return;
    if (useGameStore.getState().isSpectator) return;
    const onBoard = isBoardCell(hex);
    if (!onBoard) return;
    const k = key(hex);
    const s = useGameStore.getState();
    const isMyTurn = s.currentTurn === auth.userId;
    const cellMarble = s.board.get(k);

    // If clicking own marble — select it & request preview
    if (cellMarble && cellMarble.userId === auth.userId && isMyTurn) {
      s.setSelected(hex);
      const sock = getSocket(auth.token);
      sock.emit(SOCKET_EVENTS.GAME_REQUEST_PREVIEW, { fromQ: hex.q, fromR: hex.r });
      return;
    }

    // Eviction: clicking enemy marble in your target zone (blocking rule on)
    if (cellMarble && cellMarble.userId !== auth.userId && isMyTurn && s.blockingRule) {
      const myHome = auth.userId ? s.playerHomePoint[auth.userId] : undefined;
      if (myHome !== undefined) {
        const myTarget = new Set(HOME_TRIANGLES[opposingPoint(myHome)]!.map(key));
        if (myTarget.has(k)) {
          s.setSelected(hex);
          const sock = getSocket(auth.token);
          sock.emit(SOCKET_EVENTS.GAME_REQUEST_PREVIEW, { fromQ: hex.q, fromR: hex.r });
          return;
        }
      }
    }

    // If clicking a valid destination — submit move (server fills the path).
    if (s.selectedMarble && s.validDestinations.has(k)) {
      const sock = getSocket(auth.token);
      sock.emit(SOCKET_EVENTS.GAME_MOVE_ATTEMPT, {
        fromQ: s.selectedMarble.q,
        fromR: s.selectedMarble.r,
        toQ: hex.q,
        toR: hex.r,
      });
      s.setSelected(null);
      return;
    }

    // Click anywhere else clears selection
    s.setSelected(null);
  }

  function onClick(e: React.MouseEvent<HTMLCanvasElement>): void {
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const size = Math.min(rect.width, rect.height) / 20;
    const origin = { x: rect.width / 2, y: rect.height / 2 };
    const hex = pixelToHex(
      { x: e.clientX - rect.left, y: e.clientY - rect.top },
      size,
      origin,
    );
    useGameStore.getState().setCursor(hex);
    activateHex(hex);
  }

  // Keyboard navigation. WASD-like 6-direction picker plus arrows.
  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>): void {
    if (useGameStore.getState().isSpectator) return;
    const s = useGameStore.getState();
    if (e.key === 'Escape') {
      s.setSelected(null);
      s.setCursor(null);
      e.preventDefault();
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      if (s.cursor) activateHex(s.cursor);
      e.preventDefault();
      return;
    }
    const dir = directionForKey(e.key);
    if (!dir) return;
    e.preventDefault();
    // Initial cursor: first own marble or board origin
    let cur = s.cursor;
    if (!cur) {
      for (const [k2, marble] of s.board) {
        if (marble?.userId === auth.userId) {
          const [q, r] = k2.split(',').map(Number) as [number, number];
          cur = { q, r };
          break;
        }
      }
      if (!cur) cur = { q: 0, r: 0 };
      s.setCursor(cur);
      return;
    }
    // Step in direction; skip off-board cells by extending until we find a valid hex or give up
    for (let i = 1; i <= 12; i++) {
      const candidate = hexAdd(cur, { q: dir.q * i, r: dir.r * i });
      if (isBoardCell(candidate)) {
        s.setCursor(candidate);
        return;
      }
    }
  }

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      onKeyDown={onKeyDown}
      className="relative w-full h-full bg-canvas rounded-xl overflow-hidden focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 focus:ring-offset-canvas"
      role="application"
      aria-label="Chinese Checkers board. Use arrow keys, Q and E to move the cursor; Enter to select; Escape to deselect."
      aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight Q E Enter Space Escape"
    >
      <canvas
        ref={canvasRef}
        onClick={onClick}
        className="cursor-pointer touch-manipulation select-none"
        aria-hidden
      />
      <ScreenReaderAnnouncer />
    </div>
  );
}

function directionForKey(key: string): Hex | null {
  switch (key) {
    case 'ArrowLeft':
    case 'a':
    case 'A':
      return { q: -1, r: 0 };
    case 'ArrowRight':
    case 'd':
    case 'D':
      return { q: 1, r: 0 };
    case 'ArrowUp':
    case 'w':
    case 'W':
      return { q: 0, r: -1 };
    case 'ArrowDown':
    case 's':
    case 'S':
      return { q: 0, r: 1 };
    case 'e':
    case 'E':
      return { q: 1, r: -1 };
    case 'q':
    case 'Q':
      return { q: -1, r: 1 };
    default:
      return null;
  }
}

function ScreenReaderAnnouncer(): JSX.Element {
  const game = useGameStore();
  const last = game.lastMove;
  const text = last
    ? `Last move: from q${last.from.q} r${last.from.r} to q${last.to.q} r${last.to.r}.`
    : '';
  useEffect(() => {
    if (!last) return;
    if (typeof window === 'undefined') return;
    if (!('speechSynthesis' in window)) return;
    if (!getAnnounceMoves()) return;
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      window.speechSynthesis.speak(u);
    } catch {
      // ignore
    }
  }, [last, text]);
  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      style={{
        position: 'absolute',
        width: 1,
        height: 1,
        margin: -1,
        padding: 0,
        overflow: 'hidden',
        clip: 'rect(0, 0, 0, 0)',
        whiteSpace: 'nowrap',
        border: 0,
      }}
    >
      {text}
    </div>
  );
}
