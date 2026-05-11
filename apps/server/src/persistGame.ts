import type { GameState, PlayerColor } from '@cc/shared-types';
import { prisma } from './lib/prisma.js';
import { computeEloDeltas } from './elo.js';

export type CompletedGameInput = {
  gameId: string;
  state: GameState;
  // Configured at room creation; needed to determine ELO mode.
  blockingRule: boolean;
  moveLog: Array<{
    moveNumber: number;
    userId: string;
    fromQ: number;
    fromR: number;
    toQ: number;
    toR: number;
    path: Array<{ q: number; r: number }>;
    isTimeout: boolean;
    timestamp: Date;
  }>;
};

export type FinishOrderWithElo = Array<{
  userId: string;
  finishPos: number;
  eloDelta: number;
}>;

/**
 * Persist a completed game and compute ELO updates atomically.
 *
 * Wraps:
 *   - games row insert
 *   - game_players rows
 *   - elo_ratings upsert (per player, per mode)
 *   - elo_history rows
 *
 * Returns the finish-order array with ELO deltas for the GAME_OVER socket event.
 */
export async function persistCompletedGame(
  input: CompletedGameInput,
): Promise<FinishOrderWithElo> {
  const { state, blockingRule, moveLog } = input;
  const mode: '2p' | 'multi' = state.playerCount === 2 ? '2p' : 'multi';

  // Build the canonical finish order. Anyone not in finishedPlayers gets a
  // bottom slot in turnOrder order.
  const finishedIds = new Set(state.finishedPlayers.map((p) => p.userId));
  const trailing = state.turnOrder.filter((id) => !finishedIds.has(id));
  const order: Array<{ userId: string; finishPos: number }> = [
    ...state.finishedPlayers.map((p) => ({ userId: p.userId, finishPos: p.finishPos })),
    ...trailing.map((userId, i) => ({
      userId,
      finishPos: state.finishedPlayers.length + 1 + i,
    })),
  ];

  return prisma.$transaction(async (tx) => {
    // Read pre-game ratings (or seed at 1200).
    const ratings = await Promise.all(
      order.map(async (p) => {
        const existing = await tx.eloRating.findUnique({
          where: { userId_mode: { userId: p.userId, mode } },
        });
        return { userId: p.userId, finishPos: p.finishPos, ratingBefore: existing?.rating ?? 1200 };
      }),
    );
    const isStalemate = state.endReason === 'stalemate';
    const deltas = isStalemate
      ? new Map(ratings.map((r) => [r.userId, { delta: 0, ratingAfter: r.ratingBefore }]))
      : computeEloDeltas(ratings);

    const game = await tx.game.create({
      data: {
        id: state.gameId,
        mode: 'casual',
        playerCount: state.playerCount,
        status: 'completed',
        settings: { blockingRule },
        startedAt: new Date(Date.now() - 60_000), // approx; precise startedAt isn't tracked yet
        endedAt: new Date(),
      },
    });

    for (let i = 0; i < ratings.length; i++) {
      const r = ratings[i]!;
      const d = deltas.get(r.userId)!;
      const color: PlayerColor = (state.playerColors[r.userId] ?? 'red') as PlayerColor;
      const homePoint = state.playerHomePoint[r.userId] ?? 0;

      const gp = await tx.gamePlayer.create({
        data: {
          gameId: game.id,
          userId: r.userId,
          color,
          homePoint,
          seatOrder: state.turnOrder.indexOf(r.userId),
          finishPos: r.finishPos,
          eloBefore: r.ratingBefore,
          eloAfter: d.ratingAfter,
          eloDelta: d.delta,
        },
      });
      void gp;

      const isWin = !isStalemate && r.finishPos === 1;
      const isLoss = !isStalemate && r.finishPos === ratings.length;
      await tx.eloRating.upsert({
        where: { userId_mode: { userId: r.userId, mode } },
        create: {
          userId: r.userId,
          mode,
          rating: d.ratingAfter,
          gamesPlayed: 1,
          wins: isWin ? 1 : 0,
          losses: isLoss ? 1 : 0,
        },
        update: {
          rating: d.ratingAfter,
          gamesPlayed: { increment: 1 },
          wins: isWin ? { increment: 1 } : undefined,
          losses: isLoss ? { increment: 1 } : undefined,
        },
      });

      await tx.eloHistory.create({
        data: {
          userId: r.userId,
          gameId: game.id,
          mode,
          ratingBefore: r.ratingBefore,
          ratingAfter: d.ratingAfter,
          delta: d.delta,
        },
      });
    }

    // Persist the move log against the freshly-created GamePlayer rows.
    const playerIdByUserId = new Map<string, string>(
      (
        await tx.gamePlayer.findMany({
          where: { gameId: game.id },
          select: { id: true, userId: true },
        })
      ).map((p) => [p.userId, p.id]),
    );
    if (moveLog.length > 0) {
      await tx.move.createMany({
        data: moveLog.map((m) => ({
          gameId: game.id,
          playerId: playerIdByUserId.get(m.userId)!,
          moveNumber: m.moveNumber,
          fromQ: m.fromQ,
          fromR: m.fromR,
          toQ: m.toQ,
          toR: m.toR,
          path: m.path,
          isTimeout: m.isTimeout,
          timestamp: m.timestamp,
        })),
      });
    }

    return ratings.map((r) => {
      const d = deltas.get(r.userId)!;
      return { userId: r.userId, finishPos: r.finishPos, eloDelta: d.delta };
    });
  });
}
