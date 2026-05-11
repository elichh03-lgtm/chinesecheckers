import type { GameState } from '@cc/shared-types';
import { HOME_TRIANGLES, opposingPoint } from './board.js';

/**
 * A player wins when all 10 of their marbles occupy the opposing home triangle.
 * Empty cells in the target are NOT allowed.
 */
export function checkWin(state: GameState, playerId: string): boolean {
  const homePoint = state.playerHomePoint[playerId];
  if (homePoint === undefined) return false;
  const target = HOME_TRIANGLES[opposingPoint(homePoint)]!;
  for (const cell of target) {
    const marble = state.board.get(`${cell.q},${cell.r}`);
    if (!marble) return false;
    if (marble.userId !== playerId) return false;
  }
  return true;
}
