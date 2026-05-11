import { io, type Socket } from 'socket.io-client';
import {
  SOCKET_EVENTS,
  type ChatMessage,
  type GameMoveConfirmedEvent,
  type GameMoveRejectedEvent,
  type GameOverEvent,
  type GameStartEvent,
  type GameValidDestinationsEvent,
} from '@cc/shared-types';
import { useGameStore } from '@/stores/game';
import { useAuthStore } from '@/stores/auth';
import { playMove, playWin, resetTick } from '@/lib/sound';

let sock: Socket | null = null;

export function getSocket(token: string): Socket {
  if (sock && sock.connected) return sock;
  if (sock) sock.disconnect();
  sock = io('/game', { auth: { token } });
  wireBridge(sock);
  return sock;
}

export function disconnectSocket(): void {
  sock?.disconnect();
  sock = null;
}

function wireBridge(s: Socket): void {
  s.on('connect_error', (err) => console.error('socket connect_error', err.message));

  s.on(SOCKET_EVENTS.GAME_START, (e: GameStartEvent) => {
    useGameStore.getState().startGame(e);
  });
  s.on(SOCKET_EVENTS.GAME_MOVE_CONFIRMED, (e: GameMoveConfirmedEvent) => {
    useGameStore.getState().applyConfirmedMove(e);
    resetTick();
    playMove();
  });
  s.on(SOCKET_EVENTS.GAME_MOVE_REJECTED, (e: GameMoveRejectedEvent) => {
    console.warn('move rejected:', e.reason);
  });
  s.on(SOCKET_EVENTS.GAME_VALID_DESTINATIONS, (e: GameValidDestinationsEvent) => {
    useGameStore.getState().setValidDestinations(e.destinations);
  });
  s.on(SOCKET_EVENTS.GAME_OVER, (e: GameOverEvent) => {
    useGameStore.getState().finishGame(e.finishOrder);
    const myUserId = useAuthStore.getState().userId;
    const winner = e.finishOrder.find((p) => p.finishPos === 1);
    if (winner && myUserId && winner.userId === myUserId) playWin();
  });
  s.on(SOCKET_EVENTS.CHAT_MESSAGE, (_msg: ChatMessage) => {
    // chat handled by ChatPanel listening directly
  });
}
