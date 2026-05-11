import type { GameState, Hex, Move, ValidationResult } from '@cc/shared-types';
import { HEX_DIRECTIONS, HOME_TRIANGLES, hexAdd, hexEquals, isBoardCell, key, opposingPoint } from './board.js';

/**
 * Returns the set of cell keys that make up `playerId`'s target zone (the
 * opposing home triangle). Used by the blocking-rule eviction path.
 */
export function targetZoneKeys(state: GameState, playerId: string): Set<string> | null {
  const home = state.playerHomePoint[playerId];
  if (home === undefined) return null;
  return new Set(HOME_TRIANGLES[opposingPoint(home)]!.map(key));
}

/**
 * Validate a Chinese Checkers move.
 *
 * Move semantics (Sternhalma standard, short-hop variant):
 *   - Single step: move to an adjacent empty cell.
 *   - Hop: jump over an adjacent occupied cell to the empty cell directly
 *     beyond it (distance 2, same direction).
 *   - Chain hops: any number of consecutive hops, no cell may be revisited
 *     (including the origin).
 *
 * `move.path` must list every visited cell from origin to destination.
 */
export function validateMove(
  state: GameState,
  playerId: string,
  move: Move,
): ValidationResult {
  if (state.status !== 'active') return { valid: false, reason: 'GAME_NOT_ACTIVE' };

  if (state.finishedPlayers.some((p) => p.userId === playerId)) {
    return { valid: false, reason: 'PLAYER_FINISHED' };
  }

  const currentPlayer = state.turnOrder[state.currentTurnIndex];
  if (currentPlayer !== playerId) return { valid: false, reason: 'NOT_YOUR_TURN' };

  const from: Hex = { q: move.fromQ, r: move.fromR };
  const to: Hex = { q: move.toQ, r: move.toR };

  if (!isBoardCell(from) || !isBoardCell(to)) {
    return { valid: false, reason: 'NOT_BOARD_POSITION' };
  }

  const fromMarble = state.board.get(key(from));
  if (!fromMarble) return { valid: false, reason: 'NO_MARBLE' };

  // Ownership check, with blocking-rule eviction exception.
  // Player A may move an enemy marble that sits in A's target zone to any
  // cell OUTSIDE A's target zone.
  let isEviction = false;
  if (fromMarble.userId !== playerId) {
    if (!state.blockingRule) return { valid: false, reason: 'WRONG_OWNER' };
    const target = targetZoneKeys(state, playerId);
    if (!target) return { valid: false, reason: 'WRONG_OWNER' };
    if (!target.has(key(from))) return { valid: false, reason: 'WRONG_OWNER' };
    if (target.has(key(to))) return { valid: false, reason: 'BLOCKED' };
    isEviction = true;
  }
  void isEviction;

  if (state.board.get(key(to)) !== null) {
    return { valid: false, reason: 'INVALID_DESTINATION' };
  }

  if (!move.path || move.path.length < 2) return { valid: false, reason: 'PATH_INVALID' };
  if (!hexEquals(move.path[0]!, from)) return { valid: false, reason: 'PATH_INVALID' };
  if (!hexEquals(move.path[move.path.length - 1]!, to)) {
    return { valid: false, reason: 'PATH_INVALID' };
  }
  for (const cell of move.path) {
    if (!isBoardCell(cell)) return { valid: false, reason: 'NOT_BOARD_POSITION' };
  }

  // Single-step path
  if (move.path.length === 2) {
    const adj = HEX_DIRECTIONS.some((d) => hexEquals(hexAdd(from, d), to));
    if (adj) return { valid: true };
    // Otherwise must be a single hop
    return validateHopSegment(state, from, from, to);
  }

  // Multi-hop chain — every segment must be a hop, no revisits
  const visited = new Set<string>([key(move.path[0]!)]);
  for (let i = 0; i < move.path.length - 1; i++) {
    const a = move.path[i]!;
    const b = move.path[i + 1]!;
    const seg = validateHopSegment(state, from, a, b);
    if (!seg.valid) return seg;
    if (visited.has(key(b))) return { valid: false, reason: 'REVISITED_HOP' };
    visited.add(key(b));
  }

  return { valid: true };
}

/**
 * A single hop from `a` to `b` is valid iff:
 *   - There exists a hex direction d such that a + d + d === b.
 *   - The midpoint `a + d` is occupied (in the current board).
 *   - The destination `b` is empty — UNLESS `b` is the original origin
 *     (which is always disallowed by the revisit check, but we treat origin
 *     as empty here so that further "in-flight" reasoning is consistent).
 *   - The midpoint may not be the origin (origin is empty during the move).
 */
export function validateHopSegment(
  state: GameState,
  origin: Hex,
  a: Hex,
  b: Hex,
): ValidationResult {
  for (const d of HEX_DIRECTIONS) {
    const mid = hexAdd(a, d);
    const far = hexAdd(mid, d);
    if (!hexEquals(far, b)) continue;
    if (!isBoardCell(mid) || !isBoardCell(far)) {
      return { valid: false, reason: 'PATH_INVALID' };
    }
    // Midpoint must be occupied; treat origin as empty (marble in flight).
    if (hexEquals(mid, origin)) return { valid: false, reason: 'PATH_INVALID' };
    if (!state.board.get(key(mid))) return { valid: false, reason: 'PATH_INVALID' };
    // Far must be empty unless it's the origin (revisit caught upstream).
    const farMarble = state.board.get(key(far));
    if (farMarble && !hexEquals(far, origin)) {
      return { valid: false, reason: 'PATH_INVALID' };
    }
    return { valid: true };
  }
  return { valid: false, reason: 'PATH_INVALID' };
}
