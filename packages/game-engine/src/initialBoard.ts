import type { GameState, Marble, PlayerColor, PlayerCount } from '@cc/shared-types';
import { ALL_BOARD_CELLS, HOME_TRIANGLES, PLAYER_HOME_POINTS, key } from './board.js';

const COLORS_BY_POINT: Record<number, PlayerColor> = {
  0: 'red',
  1: 'blue',
  2: 'green',
  3: 'yellow',
  4: 'purple',
  5: 'orange',
};

export function createInitialBoard(
  playerCount: PlayerCount,
  playerIds: string[],
  opts: { blockingRule?: boolean } = {},
): GameState {
  if (playerIds.length !== playerCount) {
    throw new Error(`Expected ${playerCount} players, got ${playerIds.length}`);
  }

  const homePoints = PLAYER_HOME_POINTS[playerCount];
  const playerColors: Record<string, PlayerColor> = {};
  const playerHomePoint: Record<string, number> = {};
  const board = new Map<string, Marble | null>();

  for (const cell of ALL_BOARD_CELLS) board.set(key(cell), null);

  playerIds.forEach((userId, idx) => {
    const point = homePoints[idx]!;
    const color = COLORS_BY_POINT[point]!;
    playerColors[userId] = color;
    playerHomePoint[userId] = point;
    for (const cell of HOME_TRIANGLES[point]!) {
      board.set(key(cell), { userId, color });
    }
  });

  const timeoutStrikes: Record<string, number> = {};
  for (const id of playerIds) timeoutStrikes[id] = 0;

  return {
    gameId: '',
    status: 'waiting',
    playerCount,
    turnOrder: [...playerIds],
    currentTurnIndex: 0,
    moveCount: 0,
    timerEndsAt: 0,
    timeoutStrikes,
    finishedPlayers: [],
    board,
    playerColors,
    playerHomePoint,
    blockingRule: opts.blockingRule ?? false,
  };
}
