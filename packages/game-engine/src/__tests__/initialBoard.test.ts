import { describe, expect, it } from 'vitest';
import { createInitialBoard } from '../initialBoard.js';
import { HOME_TRIANGLES, PLAYER_HOME_POINTS, key } from '../board.js';

describe('createInitialBoard', () => {
  it('places 10 marbles per player in their home triangle', () => {
    for (const pc of [2, 3, 4, 6] as const) {
      const ids = Array.from({ length: pc }, (_, i) => `p${i}`);
      const state = createInitialBoard(pc, ids);
      expect(state.board.size).toBe(121);

      // Each player's home cells contain their marbles
      const homePoints = PLAYER_HOME_POINTS[pc];
      ids.forEach((id, idx) => {
        const point = homePoints[idx]!;
        for (const cell of HOME_TRIANGLES[point]!) {
          const m = state.board.get(key(cell));
          expect(m).toBeTruthy();
          expect(m!.userId).toBe(id);
        }
      });

      // No marbles outside home triangles
      const homeKeys = new Set<string>();
      for (const p of homePoints) {
        for (const cell of HOME_TRIANGLES[p]!) homeKeys.add(key(cell));
      }
      let nonHomeMarbles = 0;
      for (const [k, v] of state.board) {
        if (v && !homeKeys.has(k)) nonHomeMarbles++;
      }
      expect(nonHomeMarbles).toBe(0);
    }
  });

  it('initializes timeoutStrikes for each player', () => {
    const state = createInitialBoard(2, ['a', 'b']);
    expect(state.timeoutStrikes).toEqual({ a: 0, b: 0 });
    expect(state.turnOrder).toEqual(['a', 'b']);
    expect(state.currentTurnIndex).toBe(0);
    expect(state.moveCount).toBe(0);
    expect(state.status).toBe('waiting');
    expect(state.finishedPlayers).toEqual([]);
  });

  it('throws when player count mismatches', () => {
    expect(() => createInitialBoard(2, ['a'])).toThrow();
    expect(() => createInitialBoard(2, ['a', 'b', 'c'])).toThrow();
  });

  it('assigns distinct colors per player', () => {
    const state = createInitialBoard(6, ['a', 'b', 'c', 'd', 'e', 'f']);
    const colors = new Set(Object.values(state.playerColors));
    expect(colors.size).toBe(6);
  });
});
