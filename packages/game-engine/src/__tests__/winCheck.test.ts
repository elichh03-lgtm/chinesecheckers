import { describe, expect, it } from 'vitest';
import { createInitialBoard } from '../initialBoard.js';
import { checkWin } from '../winCheck.js';
import { HOME_TRIANGLES, opposingPoint, key } from '../board.js';

describe('checkWin', () => {
  it('returns false at game start', () => {
    const s = createInitialBoard(2, ['a', 'b']);
    expect(checkWin(s, 'a')).toBe(false);
    expect(checkWin(s, 'b')).toBe(false);
  });

  it('returns true when all 10 marbles fill opposing triangle', () => {
    const s = createInitialBoard(2, ['a', 'b']);
    const target = HOME_TRIANGLES[opposingPoint(s.playerHomePoint['a']!)]!;
    for (const cell of target) {
      s.board.set(key(cell), { userId: 'a', color: 'red' });
    }
    expect(checkWin(s, 'a')).toBe(true);
  });

  it('returns false when target has fewer than 10 own marbles', () => {
    const s = createInitialBoard(2, ['a', 'b']);
    const target = HOME_TRIANGLES[opposingPoint(s.playerHomePoint['a']!)]!;
    for (let i = 0; i < target.length - 1; i++) {
      s.board.set(key(target[i]!), { userId: 'a', color: 'red' });
    }
    expect(checkWin(s, 'a')).toBe(false);
  });

  it('returns false if even one cell holds an opponent marble', () => {
    const s = createInitialBoard(2, ['a', 'b']);
    const target = HOME_TRIANGLES[opposingPoint(s.playerHomePoint['a']!)]!;
    target.forEach((cell, i) => {
      const marble = i === 0 ? { userId: 'b', color: 'yellow' as const } : { userId: 'a', color: 'red' as const };
      s.board.set(key(cell), marble);
    });
    expect(checkWin(s, 'a')).toBe(false);
  });

  it('returns false for unknown player', () => {
    const s = createInitialBoard(2, ['a', 'b']);
    expect(checkWin(s, 'unknown')).toBe(false);
  });
});
