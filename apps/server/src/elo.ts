/**
 * ELO computation per DESIGN.md §11.
 *
 *   - 2P: classic ELO with K=32 (or K=16 for high-rated stable players).
 *     Winner +delta, loser -delta.
 *
 *   - Multi-player (3-6): each pair of finish positions contributes a
 *     pairwise update; final delta is the sum, scaled by 1 / (n-1) so the
 *     spread is comparable across player counts. K=32 / (n-1).
 *
 * Pure functions — no DB calls. The store/transaction layer feeds in
 * pre-game ratings and persists post-game outcomes.
 */

const K_BASE = 32;

function expectedScore(ra: number, rb: number): number {
  return 1 / (1 + Math.pow(10, (rb - ra) / 400));
}

export type FinishOrderEntry = {
  userId: string;
  finishPos: number; // 1 = winner
  ratingBefore: number;
};

export function computeEloDeltas(
  finishOrder: FinishOrderEntry[],
): Map<string, { delta: number; ratingAfter: number }> {
  const n = finishOrder.length;
  const k = n === 2 ? K_BASE : K_BASE / (n - 1);
  const deltas = new Map<string, number>();
  for (const e of finishOrder) deltas.set(e.userId, 0);

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = finishOrder[i]!;
      const b = finishOrder[j]!;
      // a finished BEFORE b → a wins the pair
      const ea = expectedScore(a.ratingBefore, b.ratingBefore);
      const da = k * (1 - ea);
      const db = -da;
      deltas.set(a.userId, deltas.get(a.userId)! + da);
      deltas.set(b.userId, deltas.get(b.userId)! + db);
    }
  }

  const out = new Map<string, { delta: number; ratingAfter: number }>();
  for (const e of finishOrder) {
    const delta = Math.round(deltas.get(e.userId) ?? 0);
    out.set(e.userId, { delta, ratingAfter: e.ratingBefore + delta });
  }
  return out;
}
