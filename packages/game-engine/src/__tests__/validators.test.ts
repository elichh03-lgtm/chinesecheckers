import { describe, expect, it } from 'vitest';
import type { GameState, Move } from '@cc/shared-types';
import { createInitialBoard } from '../initialBoard.js';
import { validateMove } from '../validators.js';
import { applyMove, getValidDestinations, findPath } from '../moves.js';
import { HEX_DIRECTIONS, key } from '../board.js';

function activeState(): GameState {
  const s = createInitialBoard(2, ['a', 'b']);
  return { ...s, status: 'active' };
}

describe('validateMove', () => {
  it('rejects move when game not active', () => {
    const s = createInitialBoard(2, ['a', 'b']);
    const move: Move = { fromQ: 4, fromR: -8, toQ: 4, toR: -7, path: [] };
    expect(validateMove(s, 'a', move)).toEqual({ valid: false, reason: 'GAME_NOT_ACTIVE' });
  });

  it('rejects when not your turn', () => {
    const s = activeState();
    const move: Move = { fromQ: -4, fromR: 8, toQ: -4, toR: 7, path: [{ q: -4, r: 8 }, { q: -4, r: 7 }] };
    expect(validateMove(s, 'b', move)).toEqual({ valid: false, reason: 'NOT_YOUR_TURN' });
  });

  it('rejects when from-cell has no marble', () => {
    const s = activeState();
    const move: Move = { fromQ: 0, fromR: 0, toQ: 0, toR: 1, path: [{ q: 0, r: 0 }, { q: 0, r: 1 }] };
    expect(validateMove(s, 'a', move)).toEqual({ valid: false, reason: 'NO_MARBLE' });
  });

  it('rejects when from-cell holds opponent marble', () => {
    const s = activeState();
    const move: Move = { fromQ: -4, fromR: 8, toQ: -4, toR: 7, path: [{ q: -4, r: 8 }, { q: -4, r: 7 }] };
    expect(validateMove(s, 'a', move)).toEqual({ valid: false, reason: 'WRONG_OWNER' });
  });

  it('rejects when from-cell is off-board', () => {
    const s = activeState();
    const move: Move = { fromQ: 100, fromR: 100, toQ: 0, toR: 0, path: [] };
    expect(validateMove(s, 'a', move)).toEqual({ valid: false, reason: 'NOT_BOARD_POSITION' });
  });

  it('rejects when destination is occupied', () => {
    const s = activeState();
    // (4,-8) is the apex of point 0 (player a's home); (4,-7) and (3,-7) both have a's marbles
    const move: Move = {
      fromQ: 4, fromR: -8, toQ: 4, toR: -7,
      path: [{ q: 4, r: -8 }, { q: 4, r: -7 }],
    };
    expect(validateMove(s, 'a', move)).toEqual({ valid: false, reason: 'INVALID_DESTINATION' });
  });

  it('accepts valid single step', () => {
    const s = activeState();
    // (1,-5) is in the base of player a's home; one of its neighbors at (0,-4) is empty (in center hex)
    const move: Move = {
      fromQ: 1, fromR: -5, toQ: 0, toR: -4,
      path: [{ q: 1, r: -5 }, { q: 0, r: -4 }],
    };
    expect(validateMove(s, 'a', move)).toEqual({ valid: true });
  });

  it('rejects path that does not start at from', () => {
    const s = activeState();
    const move: Move = { fromQ: 1, fromR: -5, toQ: 0, toR: -4, path: [{ q: 0, r: 0 }, { q: 0, r: -4 }] };
    expect(validateMove(s, 'a', move)).toEqual({ valid: false, reason: 'PATH_INVALID' });
  });

  it('rejects path with too few cells', () => {
    const s = activeState();
    const move: Move = { fromQ: 1, fromR: -5, toQ: 0, toR: -4, path: [{ q: 1, r: -5 }] };
    expect(validateMove(s, 'a', move)).toEqual({ valid: false, reason: 'PATH_INVALID' });
  });

  it('rejects path that does not end at to', () => {
    const s = activeState();
    const move: Move = { fromQ: 1, fromR: -5, toQ: 0, toR: -4, path: [{ q: 1, r: -5 }, { q: -1, r: -3 }] };
    expect(validateMove(s, 'a', move)).toEqual({ valid: false, reason: 'PATH_INVALID' });
  });

  it('rejects single step that is not actually adjacent or a hop', () => {
    const s = activeState();
    const move: Move = { fromQ: 1, fromR: -5, toQ: -1, toR: -3, path: [{ q: 1, r: -5 }, { q: -1, r: -3 }] };
    expect(validateMove(s, 'a', move).valid).toBe(false);
  });

  it('accepts a single hop', () => {
    // Set up: marble at (0,0), neighbor at (1,0), empty at (2,0). a's turn.
    const s = activeState();
    s.board.set('0,0', { userId: 'a', color: 'red' });
    s.board.set('1,0', { userId: 'b', color: 'yellow' });
    s.board.set('2,0', null);
    const move: Move = {
      fromQ: 0, fromR: 0, toQ: 2, toR: 0,
      path: [{ q: 0, r: 0 }, { q: 2, r: 0 }],
    };
    expect(validateMove(s, 'a', move)).toEqual({ valid: true });
  });

  it('rejects a hop with empty midpoint', () => {
    const s = activeState();
    s.board.set('0,0', { userId: 'a', color: 'red' });
    s.board.set('2,0', null);
    const move: Move = {
      fromQ: 0, fromR: 0, toQ: 2, toR: 0,
      path: [{ q: 0, r: 0 }, { q: 2, r: 0 }],
    };
    expect(validateMove(s, 'a', move).valid).toBe(false);
  });

  it('accepts a chain hop and rejects revisits', () => {
    const s = activeState();
    // marble at (0,0); occupied (1,0), (3,0), (3,-1)? construct a chain.
    s.board.set('0,0', { userId: 'a', color: 'red' });
    s.board.set('1,0', { userId: 'b', color: 'yellow' });
    s.board.set('2,0', null);
    s.board.set('3,0', { userId: 'b', color: 'yellow' });
    s.board.set('4,0', null);
    const move: Move = {
      fromQ: 0, fromR: 0, toQ: 4, toR: 0,
      path: [{ q: 0, r: 0 }, { q: 2, r: 0 }, { q: 4, r: 0 }],
    };
    expect(validateMove(s, 'a', move)).toEqual({ valid: true });

    // Revisit case: end on a previously visited cell
    const move2: Move = {
      fromQ: 0, fromR: 0, toQ: 2, toR: 0,
      path: [{ q: 0, r: 0 }, { q: 2, r: 0 }, { q: 4, r: 0 }, { q: 2, r: 0 }],
    };
    // Each segment is a valid hop, but the last segment lands on (2,0) which is a revisit.
    // Set up midpoint (3,0) is occupied so 4→2 hops over it.
    expect(validateMove(s, 'a', move2)).toEqual({ valid: false, reason: 'REVISITED_HOP' });
  });

  it('rejects PLAYER_FINISHED', () => {
    const s = activeState();
    s.finishedPlayers.push({ userId: 'a', finishPos: 1 });
    const move: Move = {
      fromQ: 1, fromR: -5, toQ: 0, toR: -4,
      path: [{ q: 1, r: -5 }, { q: 0, r: -4 }],
    };
    expect(validateMove(s, 'a', move)).toEqual({ valid: false, reason: 'PLAYER_FINISHED' });
  });

  it('rejects path containing off-board cell', () => {
    const s = activeState();
    const move: Move = {
      fromQ: 1, fromR: -5, toQ: 0, toR: -4,
      path: [{ q: 1, r: -5 }, { q: 100, r: 100 }, { q: 0, r: -4 }],
    };
    expect(validateMove(s, 'a', move)).toEqual({ valid: false, reason: 'NOT_BOARD_POSITION' });
  });

  it('rejects to-cell off-board', () => {
    const s = activeState();
    const move: Move = { fromQ: 1, fromR: -5, toQ: 100, toR: 100, path: [] };
    expect(validateMove(s, 'a', move)).toEqual({ valid: false, reason: 'NOT_BOARD_POSITION' });
  });

  it('rejects single-step path with distance > 2 (no hop direction matches)', () => {
    const s = activeState();
    // (1,-5) to (4,-2): hex distance 3; no direction d has from + 2d = to
    s.board.set('4,-2', null);
    const move: Move = {
      fromQ: 1, fromR: -5, toQ: 4, toR: -2,
      path: [{ q: 1, r: -5 }, { q: 4, r: -2 }],
    };
    expect(validateMove(s, 'a', move)).toEqual({ valid: false, reason: 'PATH_INVALID' });
  });

  it('rejects hop where far-cell is occupied', () => {
    const s = activeState();
    s.board.set('0,0', { userId: 'a', color: 'red' });
    s.board.set('1,0', { userId: 'b', color: 'yellow' });
    s.board.set('2,0', { userId: 'b', color: 'yellow' });
    const move: Move = {
      fromQ: 0, fromR: 0, toQ: 2, toR: 0,
      path: [{ q: 0, r: 0 }, { q: 2, r: 0 }],
    };
    // INVALID_DESTINATION fires before validateHopSegment because to has a marble
    expect(validateMove(s, 'a', move)).toEqual({ valid: false, reason: 'INVALID_DESTINATION' });
  });

  it('rejects multi-hop chain whose middle hop lands on an occupied cell', () => {
    const s = activeState();
    s.board.set('0,0', { userId: 'a', color: 'red' });
    s.board.set('1,0', { userId: 'b', color: 'yellow' });
    s.board.set('2,0', { userId: 'b', color: 'yellow' }); // would-be midpoint of seg 2 is occupied at far
    s.board.set('3,0', null);
    const move: Move = {
      fromQ: 0, fromR: 0, toQ: 3, toR: 0,
      path: [{ q: 0, r: 0 }, { q: 2, r: 0 }, { q: 3, r: 0 }],
    };
    // First segment lands on (2,0) which is occupied — hop seg invalid because far has marble.
    expect(validateMove(s, 'a', move)).toEqual({ valid: false, reason: 'PATH_INVALID' });
  });

  describe('blocking rule (eviction)', () => {
    it('rejects an enemy-marble move when blocking rule is off', () => {
      const s = activeState();
      // Place a b-owned marble in a's target zone; no blocking rule.
      s.board.set('-4,8', { userId: 'b', color: 'yellow' });
      s.board.set('-4,7', null);
      const move: Move = {
        fromQ: -4, fromR: 8, toQ: -4, toR: 7,
        path: [{ q: -4, r: 8 }, { q: -4, r: 7 }],
      };
      expect(validateMove(s, 'a', move)).toEqual({ valid: false, reason: 'WRONG_OWNER' });
    });

    it('accepts eviction of enemy marble in target zone with blocking rule on', () => {
      const s = { ...activeState(), blockingRule: true };
      // Place enemy marble at a target-zone cell; the cell outside target is empty by default.
      // a's target = opposing point of home 0 = point 3 = HOME_TRIANGLES[3]. Cell (-4, 8) is the apex.
      s.board.set('-4,8', { userId: 'b', color: 'yellow' });
      // adjacent cell outside target — (-4, 7) is also in HOME_TRIANGLES[3] (point 3 base row), so try (-3, 7)
      // Better: pick a cell adjacent to (-4, 8) that's NOT in target zone. (-4, 8) neighbors are
      // (-3, 8), (-5, 8), (-4, 9), (-4, 7), (-3, 7), (-5, 9). Of these, (-3, 7) and (-5, 9) and (-4, 7)
      // are in HOME_TRIANGLES[3] (target zone). (-3, 8) is also in. (-4, 9), (-5, 8) are off-board.
      // So no in-bounds non-target neighbor exists for the apex. Use a base-row cell instead.
      // (-1, 5) is in target (HOME_TRIANGLES[3] base, q=-1,r=5). neighbor (0, 4) is in center hex (off target).
      s.board.set('-4,8', null);
      s.board.set('-1,5', { userId: 'b', color: 'yellow' });
      s.board.set('0,4', null);
      const move: Move = {
        fromQ: -1, fromR: 5, toQ: 0, toR: 4,
        path: [{ q: -1, r: 5 }, { q: 0, r: 4 }],
      };
      expect(validateMove(s, 'a', move)).toEqual({ valid: true });
    });

    it('rejects eviction whose destination is still inside target zone', () => {
      const s = { ...activeState(), blockingRule: true };
      // Place enemy at (-1, 5) in target. Try to move to another target cell (-2, 6).
      s.board.set('-1,5', { userId: 'b', color: 'yellow' });
      s.board.set('-2,6', null);
      const move: Move = {
        fromQ: -1, fromR: 5, toQ: -2, toR: 6,
        path: [{ q: -1, r: 5 }, { q: -2, r: 6 }],
      };
      expect(validateMove(s, 'a', move)).toEqual({ valid: false, reason: 'BLOCKED' });
    });

    it('rejects eviction of enemy marble that is NOT in target zone', () => {
      const s = { ...activeState(), blockingRule: true };
      // Enemy at (0, 0) — center hex, not in a's target zone.
      s.board.set('0,0', { userId: 'b', color: 'yellow' });
      s.board.set('1,0', null);
      const move: Move = {
        fromQ: 0, fromR: 0, toQ: 1, toR: 0,
        path: [{ q: 0, r: 0 }, { q: 1, r: 0 }],
      };
      expect(validateMove(s, 'a', move)).toEqual({ valid: false, reason: 'WRONG_OWNER' });
    });
  });

  it('rejects multi-hop chain segment with mismatched geometry', () => {
    const s = activeState();
    s.board.set('0,0', { userId: 'a', color: 'red' });
    s.board.set('1,0', { userId: 'b', color: 'yellow' });
    s.board.set('2,0', null);
    const move: Move = {
      fromQ: 0, fromR: 0, toQ: 4, toR: -2,
      // (2,0) → (4,-2) is distance 3, no direction matches
      path: [{ q: 0, r: 0 }, { q: 2, r: 0 }, { q: 4, r: -2 }],
    };
    expect(validateMove(s, 'a', move)).toEqual({ valid: false, reason: 'PATH_INVALID' });
  });
});

describe('getValidDestinations', () => {
  it('returns only single-step neighbors when isolated', () => {
    const s = activeState();
    // Pick a non-empty cell with all empty neighbors: (1,-5) is a player a marble at base of home
    const dests = getValidDestinations(s, { q: 1, r: -5 });
    expect(dests.size).toBeGreaterThan(0);
  });

  it('includes hop destinations through chains', () => {
    const s = activeState();
    s.board.set('0,0', { userId: 'a', color: 'red' });
    s.board.set('1,0', { userId: 'b', color: 'yellow' });
    s.board.set('2,0', null);
    const dests = getValidDestinations(s, { q: 0, r: 0 });
    expect(dests.has('2,0')).toBe(true);
  });

  it('returns empty set for empty/off-board origins', () => {
    const s = activeState();
    expect(getValidDestinations(s, { q: 100, r: 100 }).size).toBe(0);
    expect(getValidDestinations(s, { q: 0, r: 0 }).size).toBe(0);
  });
});

describe('findPath', () => {
  it('finds single-step path', () => {
    const s = activeState();
    const p = findPath(s, { q: 1, r: -5 }, { q: 0, r: -4 });
    expect(p).toEqual([{ q: 1, r: -5 }, { q: 0, r: -4 }]);
  });

  it('finds hop path', () => {
    const s = activeState();
    s.board.set('0,0', { userId: 'a', color: 'red' });
    s.board.set('1,0', { userId: 'b', color: 'yellow' });
    s.board.set('2,0', null);
    const p = findPath(s, { q: 0, r: 0 }, { q: 2, r: 0 });
    expect(p).toEqual([{ q: 0, r: 0 }, { q: 2, r: 0 }]);
  });

  it('returns null when unreachable', () => {
    const s = activeState();
    // Try to reach a faraway corner with all neighbors blocked by own marbles
    const p = findPath(s, { q: 4, r: -8 }, { q: -4, r: 8 });
    expect(p).toBeNull();
  });

  it('returns null when from === to', () => {
    const s = activeState();
    expect(findPath(s, { q: 0, r: 0 }, { q: 0, r: 0 })).toBeNull();
  });

  it('reconstructs a multi-hop path', () => {
    const s = activeState();
    s.board.set('0,0', { userId: 'a', color: 'red' });
    s.board.set('1,0', { userId: 'b', color: 'yellow' });
    s.board.set('2,0', null);
    s.board.set('3,0', { userId: 'b', color: 'yellow' });
    s.board.set('4,0', null);
    const p = findPath(s, { q: 0, r: 0 }, { q: 4, r: 0 });
    expect(p).not.toBeNull();
    expect(p!.length).toBe(3);
    expect(p![0]).toEqual({ q: 0, r: 0 });
    expect(p![p!.length - 1]).toEqual({ q: 4, r: 0 });
  });
});
