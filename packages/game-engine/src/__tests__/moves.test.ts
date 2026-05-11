import { describe, expect, it } from 'vitest';
import type { GameState, Move } from '@cc/shared-types';
import { createInitialBoard } from '../initialBoard.js';
import { applyMove, getAllValidMoves, getValidDestinations, findPath } from '../moves.js';
import { HOME_TRIANGLES, opposingPoint, key } from '../board.js';

function activeState(): GameState {
  return { ...createInitialBoard(2, ['a', 'b']), status: 'active' };
}

describe('applyMove', () => {
  it('moves the marble immutably', () => {
    const s = activeState();
    const move: Move = {
      fromQ: 1, fromR: -5, toQ: 0, toR: -4,
      path: [{ q: 1, r: -5 }, { q: 0, r: -4 }],
    };
    const next = applyMove(s, move);
    expect(s.board.get('1,-5')).toBeTruthy(); // original unchanged
    expect(s.board.get('0,-4')).toBeNull();
    expect(next.board.get('1,-5')).toBeNull();
    expect(next.board.get('0,-4')!.userId).toBe('a');
    expect(next.moveCount).toBe(1);
    expect(next.currentTurnIndex).toBe(1);
  });

  it('records a finish when the move completes the player', () => {
    const s = activeState();
    // Pre-fill 9 of 10 target cells with a's marbles, leave one empty.
    const target = HOME_TRIANGLES[opposingPoint(s.playerHomePoint['a']!)]!;
    const finishCell = target[0]!;
    target.slice(1).forEach((cell) => s.board.set(key(cell), { userId: 'a', color: 'red' }));
    // Place an a marble adjacent to finishCell to step into it.
    // Find a neighbor of finishCell that's a board cell, and move it.
    // For simplicity put one at the cell itself's neighbor — just move from any
    // a-marble we can. Place a marble at adjacent cell, ensure source path is single-step.
    // (We're constructing an artificial state; correctness of the specific path
    // isn't required since validateMove is bypassed here.)
    const adjacent = { q: finishCell.q + 1, r: finishCell.r };
    s.board.set(key(adjacent), { userId: 'a', color: 'red' });
    // Clear a's home so total a marbles still equals 10
    const home = HOME_TRIANGLES[s.playerHomePoint['a']!]!;
    home.forEach((cell) => s.board.set(key(cell), null));

    const move: Move = {
      fromQ: adjacent.q, fromR: adjacent.r,
      toQ: finishCell.q, toR: finishCell.r,
      path: [adjacent, finishCell],
    };
    const next = applyMove(s, move);
    expect(next.finishedPlayers.some((p) => p.userId === 'a' && p.finishPos === 1)).toBe(true);
  });

  it('completes the game when only one player remains', () => {
    const s = activeState();
    s.finishedPlayers.push({ userId: 'a', finishPos: 1 });
    s.currentTurnIndex = 1; // b's turn
    const move: Move = {
      fromQ: -1, fromR: 5, toQ: 0, toR: 4,
      path: [{ q: -1, r: 5 }, { q: 0, r: 4 }],
    };
    const next = applyMove(s, move);
    expect(next.status).toBe('completed');
  });

  it('skips finished players when advancing turn', () => {
    const s = { ...createInitialBoard(3, ['a', 'b', 'c']), status: 'active' as const };
    s.finishedPlayers.push({ userId: 'b', finishPos: 1 });
    s.currentTurnIndex = 0;
    // Make any move for 'a' — pick one of a's home base cells with a free neighbor.
    const home = HOME_TRIANGLES[s.playerHomePoint['a']!]!;
    const fromCell = home.find((c) => {
      // pick a cell with at least one empty neighbor
      const neighbors = [
        { q: c.q + 1, r: c.r }, { q: c.q - 1, r: c.r },
        { q: c.q, r: c.r + 1 }, { q: c.q, r: c.r - 1 },
        { q: c.q + 1, r: c.r - 1 }, { q: c.q - 1, r: c.r + 1 },
      ];
      return neighbors.some((n) => s.board.get(key(n)) === null);
    })!;
    const neighbor = [
      { q: fromCell.q + 1, r: fromCell.r }, { q: fromCell.q - 1, r: fromCell.r },
      { q: fromCell.q, r: fromCell.r + 1 }, { q: fromCell.q, r: fromCell.r - 1 },
      { q: fromCell.q + 1, r: fromCell.r - 1 }, { q: fromCell.q - 1, r: fromCell.r + 1 },
    ].find((n) => s.board.get(key(n)) === null)!;
    const move: Move = {
      fromQ: fromCell.q, fromR: fromCell.r,
      toQ: neighbor.q, toR: neighbor.r,
      path: [fromCell, neighbor],
    };
    const next = applyMove(s, move);
    // Should skip b (finished) and land on c (index 2)
    expect(next.currentTurnIndex).toBe(2);
  });
});

describe('getAllValidMoves', () => {
  it('returns at least one move from initial state', () => {
    const s = activeState();
    const moves = getAllValidMoves(s, 'a');
    expect(moves.length).toBeGreaterThan(0);
    for (const m of moves) {
      expect(m.path.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('returns empty for player with no marbles', () => {
    const s = activeState();
    expect(getAllValidMoves(s, 'unknown').length).toBe(0);
  });
});

describe('getValidDestinations integration', () => {
  it('a chain hop reachable square is included', () => {
    const s = activeState();
    s.board.set('0,0', { userId: 'a', color: 'red' });
    s.board.set('1,0', { userId: 'b', color: 'yellow' });
    s.board.set('2,0', null);
    s.board.set('3,0', { userId: 'b', color: 'yellow' });
    s.board.set('4,0', null);
    const dests = getValidDestinations(s, { q: 0, r: 0 });
    expect(dests.has('2,0')).toBe(true);
    expect(dests.has('4,0')).toBe(true);
  });
});
