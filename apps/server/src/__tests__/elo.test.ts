import { describe, expect, it } from 'vitest';
import { computeEloDeltas } from '../elo.js';

describe('computeEloDeltas', () => {
  it('classic 2P: equal-rated winner gains ~K/2', () => {
    const out = computeEloDeltas([
      { userId: 'a', finishPos: 1, ratingBefore: 1200 },
      { userId: 'b', finishPos: 2, ratingBefore: 1200 },
    ]);
    expect(out.get('a')!.delta).toBe(16);
    expect(out.get('b')!.delta).toBe(-16);
    // Zero sum at equal ratings
    expect(out.get('a')!.delta + out.get('b')!.delta).toBe(0);
  });

  it('higher-rated favorite gains less when winning', () => {
    const out = computeEloDeltas([
      { userId: 'fav', finishPos: 1, ratingBefore: 1600 },
      { userId: 'dog', finishPos: 2, ratingBefore: 1200 },
    ]);
    expect(out.get('fav')!.delta).toBeGreaterThan(0);
    expect(out.get('fav')!.delta).toBeLessThan(16);
  });

  it('upset: lower-rated wins → larger delta', () => {
    const out = computeEloDeltas([
      { userId: 'dog', finishPos: 1, ratingBefore: 1200 },
      { userId: 'fav', finishPos: 2, ratingBefore: 1600 },
    ]);
    expect(out.get('dog')!.delta).toBeGreaterThan(16);
  });

  it('multiplayer: deltas roughly sum to zero', () => {
    const out = computeEloDeltas([
      { userId: 'a', finishPos: 1, ratingBefore: 1200 },
      { userId: 'b', finishPos: 2, ratingBefore: 1200 },
      { userId: 'c', finishPos: 3, ratingBefore: 1200 },
      { userId: 'd', finishPos: 4, ratingBefore: 1200 },
    ]);
    const total = ['a', 'b', 'c', 'd'].reduce((sum, u) => sum + out.get(u)!.delta, 0);
    // Rounding may produce off-by-one but magnitude should be small
    expect(Math.abs(total)).toBeLessThanOrEqual(2);
    // Winner positive, last place negative
    expect(out.get('a')!.delta).toBeGreaterThan(0);
    expect(out.get('d')!.delta).toBeLessThan(0);
  });

  it('ratingAfter = ratingBefore + delta', () => {
    const out = computeEloDeltas([
      { userId: 'a', finishPos: 1, ratingBefore: 1300 },
      { userId: 'b', finishPos: 2, ratingBefore: 1100 },
    ]);
    expect(out.get('a')!.ratingAfter).toBe(1300 + out.get('a')!.delta);
    expect(out.get('b')!.ratingAfter).toBe(1100 + out.get('b')!.delta);
  });
});
