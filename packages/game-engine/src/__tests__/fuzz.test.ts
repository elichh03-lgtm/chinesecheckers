import { describe, expect, it } from 'vitest';
import type { GameState } from '@cc/shared-types';
import {
  applyMove,
  createInitialBoard,
  getAllValidMoves,
  validateMove,
} from '../index.js';

/**
 * Smoke fuzz: play a few hundred random games to depth N. Every state the
 * engine produces should:
 *   - have 121 board cells (no key churn)
 *   - have stable marble counts per player (no marbles vanishing)
 *   - never accept its own generated move with reason != valid
 */
describe('engine fuzz', () => {
  it('random 2P play preserves invariants across many moves', () => {
    const ITERATIONS = 100;
    const MAX_MOVES = 50;

    for (let i = 0; i < ITERATIONS; i++) {
      let state: GameState = { ...createInitialBoard(2, ['a', 'b']), status: 'active' };
      const initialCounts = countMarbles(state);

      for (let m = 0; m < MAX_MOVES; m++) {
        const player = state.turnOrder[state.currentTurnIndex]!;
        const moves = getAllValidMoves(state, player);
        if (moves.length === 0) break;
        const choice = moves[Math.floor(Math.random() * moves.length)]!;
        const result = validateMove(state, player, choice);
        expect(result).toEqual({ valid: true });

        state = applyMove(state, choice);
        expect(state.board.size).toBe(121);
        expect(countMarbles(state)).toEqual(initialCounts);
        if (state.status === 'completed') break;
      }
    }
  });

  it('random 4P play preserves invariants', () => {
    const state0: GameState = { ...createInitialBoard(4, ['a', 'b', 'c', 'd']), status: 'active' };
    const initialCounts = countMarbles(state0);
    let state: GameState = state0;
    for (let m = 0; m < 40; m++) {
      const player = state.turnOrder[state.currentTurnIndex]!;
      if (state.finishedPlayers.some((p) => p.userId === player)) {
        // Skip finished — shouldn't happen because applyMove advances over them
        break;
      }
      const moves = getAllValidMoves(state, player);
      if (moves.length === 0) break;
      const choice = moves[Math.floor(Math.random() * moves.length)]!;
      const result = validateMove(state, player, choice);
      expect(result).toEqual({ valid: true });
      state = applyMove(state, choice);
      expect(state.board.size).toBe(121);
      expect(countMarbles(state)).toEqual(initialCounts);
    }
  });
});

function countMarbles(state: GameState): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const m of state.board.values()) {
    if (!m) continue;
    counts[m.userId] = (counts[m.userId] ?? 0) + 1;
  }
  return counts;
}
