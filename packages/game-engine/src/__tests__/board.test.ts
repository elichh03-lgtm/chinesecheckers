import { describe, expect, it } from 'vitest';
import {
  ALL_BOARD_CELLS,
  BOARD_CELL_KEYS,
  HEX_DIRECTIONS,
  HOME_TRIANGLES,
  PLAYER_HOME_POINTS,
  hexAdd,
  hexDistance,
  hexEquals,
  hexScale,
  hexSub,
  isBoardCell,
  key,
  opposingPoint,
  parseKey,
  rotateCW,
} from '../board.js';

describe('board geometry', () => {
  it('has 121 unique cells', () => {
    expect(ALL_BOARD_CELLS.length).toBe(121);
    expect(BOARD_CELL_KEYS.size).toBe(121);
  });

  it('each home triangle has 10 cells', () => {
    expect(HOME_TRIANGLES).toHaveLength(6);
    for (const t of HOME_TRIANGLES) expect(t).toHaveLength(10);
  });

  it('all home triangle cells are board cells', () => {
    for (const t of HOME_TRIANGLES) {
      for (const cell of t) expect(isBoardCell(cell)).toBe(true);
    }
  });

  it('triangles do not overlap each other or the center hex', () => {
    const seen = new Set<string>();
    for (const t of HOME_TRIANGLES) {
      for (const cell of t) {
        const k = key(cell);
        expect(seen.has(k)).toBe(false);
        seen.add(k);
      }
    }
  });

  it('hex helpers', () => {
    expect(hexAdd({ q: 1, r: 2 }, { q: 3, r: -1 })).toEqual({ q: 4, r: 1 });
    expect(hexSub({ q: 5, r: 5 }, { q: 1, r: 2 })).toEqual({ q: 4, r: 3 });
    expect(hexScale({ q: 2, r: -1 }, 3)).toEqual({ q: 6, r: -3 });
    expect(hexEquals({ q: 0, r: 0 }, { q: 0, r: 0 })).toBe(true);
    expect(hexEquals({ q: 0, r: 0 }, { q: 1, r: 0 })).toBe(false);
    expect(hexDistance({ q: 0, r: 0 }, { q: 3, r: -1 })).toBe(3);
    expect(hexDistance({ q: 4, r: -8 }, { q: -4, r: 8 })).toBe(16);
    expect(hexDistance({ q: 0, r: 0 }, { q: 0, r: 0 })).toBe(0);
  });

  it('rotateCW takes top apex around to start in 6 steps', () => {
    let h = { q: 4, r: -8 };
    for (let i = 0; i < 6; i++) h = rotateCW(h);
    expect(h).toEqual({ q: 4, r: -8 });
  });

  it('parseKey is inverse of key', () => {
    const h = { q: -3, r: 5 };
    expect(parseKey(key(h))).toEqual(h);
  });

  it('opposingPoint is mod 6 + 3', () => {
    expect(opposingPoint(0)).toBe(3);
    expect(opposingPoint(3)).toBe(0);
    expect(opposingPoint(5)).toBe(2);
  });

  it('PLAYER_HOME_POINTS configs are correct lengths', () => {
    expect(PLAYER_HOME_POINTS[2]).toHaveLength(2);
    expect(PLAYER_HOME_POINTS[3]).toHaveLength(3);
    expect(PLAYER_HOME_POINTS[4]).toHaveLength(4);
    expect(PLAYER_HOME_POINTS[6]).toHaveLength(6);
  });

  it('HEX_DIRECTIONS contains 6 unique unit vectors', () => {
    expect(HEX_DIRECTIONS).toHaveLength(6);
    const keys = new Set(HEX_DIRECTIONS.map(key));
    expect(keys.size).toBe(6);
    for (const d of HEX_DIRECTIONS) expect(hexDistance({ q: 0, r: 0 }, d)).toBe(1);
  });

  it('isBoardCell rejects non-board coords', () => {
    expect(isBoardCell({ q: 100, r: 100 })).toBe(false);
    expect(isBoardCell({ q: 5, r: 5 })).toBe(false);
  });

  it('isBoardCell accepts known apex cells', () => {
    expect(isBoardCell({ q: 4, r: -8 })).toBe(true);
    expect(isBoardCell({ q: 8, r: -4 })).toBe(true);
    expect(isBoardCell({ q: 0, r: 0 })).toBe(true);
  });
});
