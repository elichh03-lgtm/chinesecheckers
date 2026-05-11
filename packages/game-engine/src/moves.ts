import type { GameState, Hex, Marble, Move } from '@cc/shared-types';
import { HEX_DIRECTIONS, HOME_TRIANGLES, hexAdd, hexEquals, isBoardCell, key, opposingPoint } from './board.js';
import { checkWin } from './winCheck.js';

/**
 * Apply a (presumed-valid) move to the state. Returns a new GameState.
 * The board Map is rebuilt so the original state is not mutated.
 */
export function applyMove(state: GameState, move: Move): GameState {
  const fromKey = `${move.fromQ},${move.fromR}`;
  const toKey = `${move.toQ},${move.toR}`;
  const marble = state.board.get(fromKey) ?? null;

  const board = new Map(state.board);
  board.set(fromKey, null);
  board.set(toKey, marble);

  const movedPlayerId = state.turnOrder[state.currentTurnIndex]!;

  // After the move check if the moving player just finished.
  const updatedFinished = [...state.finishedPlayers];
  const tempState: GameState = {
    ...state,
    board,
    finishedPlayers: updatedFinished,
  };
  if (
    !updatedFinished.some((p) => p.userId === movedPlayerId) &&
    checkWin(tempState, movedPlayerId)
  ) {
    updatedFinished.push({
      userId: movedPlayerId,
      finishPos: updatedFinished.length + 1,
    });
  }

  // Advance turn to the next non-finished player.
  let nextIdx = state.currentTurnIndex;
  const remaining = state.turnOrder.length - updatedFinished.length;
  if (remaining > 0) {
    do {
      nextIdx = (nextIdx + 1) % state.turnOrder.length;
    } while (updatedFinished.some((p) => p.userId === state.turnOrder[nextIdx]));
  }

  const status = updatedFinished.length >= state.turnOrder.length - 1 ? 'completed' : state.status;

  return {
    ...state,
    board,
    currentTurnIndex: nextIdx,
    moveCount: state.moveCount + 1,
    finishedPlayers: updatedFinished,
    status,
  };
}

/**
 * Compute the set of cells the marble at `from` can legally reach this turn.
 * Returns a Set of "q,r" strings.
 *
 * If `playerId` is supplied AND the marble at `from` is an enemy AND the
 * blocking rule is on AND `from` is in `playerId`'s target zone, this returns
 * eviction destinations: cells outside `playerId`'s target zone reachable via
 * standard step/hop rules.
 */
export function getValidDestinations(
  state: GameState,
  from: Hex,
  playerId?: string,
): Set<string> {
  const out = new Set<string>();
  if (!isBoardCell(from)) return out;
  const fromMarble = state.board.get(key(from));
  if (!fromMarble) return out;

  // Eviction filter: if the from-marble isn't the requesting player's, only
  // proceed when the blocking-rule conditions are met, and restrict to
  // destinations OUTSIDE the player's target zone.
  let evictionTargetExclude: Set<string> | null = null;
  if (playerId !== undefined && fromMarble.userId !== playerId) {
    if (!state.blockingRule) return out;
    const home = state.playerHomePoint[playerId];
    if (home === undefined) return out;
    const target = new Set(HOME_TRIANGLES[opposingPoint(home)]!.map(key));
    if (!target.has(key(from))) return out;
    evictionTargetExclude = target;
  }

  const accept = (dest: Hex): boolean =>
    evictionTargetExclude === null || !evictionTargetExclude.has(key(dest));

  // Single-step neighbors
  for (const d of HEX_DIRECTIONS) {
    const n = hexAdd(from, d);
    if (!isBoardCell(n)) continue;
    if (state.board.get(key(n)) === null && accept(n)) out.add(key(n));
  }

  // Chain hops via BFS
  const visited = new Set<string>([key(from)]);
  const queue: Hex[] = [from];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const d of HEX_DIRECTIONS) {
      const mid = hexAdd(cur, d);
      const far = hexAdd(mid, d);
      if (!isBoardCell(mid) || !isBoardCell(far)) continue;
      if (hexEquals(mid, from)) continue;
      if (!state.board.get(key(mid))) continue;
      if (state.board.get(key(far)) !== null && !hexEquals(far, from)) continue;
      const k = key(far);
      if (visited.has(k)) continue;
      if (hexEquals(far, from)) continue;
      visited.add(k);
      if (accept(far)) out.add(k);
      queue.push(far);
    }
  }
  return out;
}

/** Compute one shortest path of waypoints from `from` to `to` (assumed reachable). */
export function findPath(state: GameState, from: Hex, to: Hex): Hex[] | null {
  if (hexEquals(from, to)) return null;
  // Single-step
  for (const d of HEX_DIRECTIONS) {
    if (hexEquals(hexAdd(from, d), to) && state.board.get(key(to)) === null) {
      return [from, to];
    }
  }
  // BFS over hop graph
  const prev = new Map<string, Hex>();
  const visited = new Set<string>([key(from)]);
  const queue: Hex[] = [from];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const d of HEX_DIRECTIONS) {
      const mid = hexAdd(cur, d);
      const far = hexAdd(mid, d);
      if (!isBoardCell(mid) || !isBoardCell(far)) continue;
      if (hexEquals(mid, from)) continue;
      if (!state.board.get(key(mid))) continue;
      if (state.board.get(key(far)) !== null && !hexEquals(far, from)) continue;
      if (hexEquals(far, from)) continue;
      const k = key(far);
      if (visited.has(k)) continue;
      visited.add(k);
      prev.set(k, cur);
      if (hexEquals(far, to)) {
        const path: Hex[] = [to];
        let p = cur;
        while (!hexEquals(p, from)) {
          path.unshift(p);
          p = prev.get(key(p))!;
        }
        path.unshift(from);
        return path;
      }
      queue.push(far);
    }
  }
  return null;
}

/**
 * Enumerate every legal move for `playerId` (used for auto-timeout). Includes
 * eviction moves when the blocking rule is on.
 */
export function getAllValidMoves(state: GameState, playerId: string): Move[] {
  const moves: Move[] = [];
  const home = state.playerHomePoint[playerId];
  const targetZone = home !== undefined
    ? new Set(HOME_TRIANGLES[opposingPoint(home)]!.map(key))
    : null;

  for (const [k, marble] of state.board) {
    if (!marble) continue;
    const isOwn = marble.userId === playerId;
    const isEvictable =
      !isOwn && state.blockingRule && targetZone !== null && targetZone.has(k);
    if (!isOwn && !isEvictable) continue;

    const [q, r] = k.split(',').map(Number) as [number, number];
    const from: Hex = { q, r };
    const dests = getValidDestinations(state, from, isOwn ? undefined : playerId);
    for (const dk of dests) {
      const [tq, tr] = dk.split(',').map(Number) as [number, number];
      const to: Hex = { q: tq, r: tr };
      const path = findPath(state, from, to);
      if (path) {
        moves.push({ fromQ: q, fromR: r, toQ: tq, toR: tr, path });
      }
    }
  }
  return moves;
}

export type { Marble };
