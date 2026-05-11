import { useEffect, useRef, useState } from 'react';
import { SOCKET_EVENTS, type ChatMessage } from '@cc/shared-types';
import { getSocket } from '@/socket/client';
import { useAuthStore } from '@/stores/auth';

export function ChatPanel(): JSX.Element {
  const auth = useAuthStore();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!auth.token) return;
    const sock = getSocket(auth.token);
    function onMsg(m: ChatMessage): void {
      setMessages((prev) => [...prev.slice(-199), m]);
    }
    sock.on(SOCKET_EVENTS.CHAT_MESSAGE, onMsg);
    return () => {
      sock.off(SOCKET_EVENTS.CHAT_MESSAGE, onMsg);
    };
  }, [auth.token]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  function send(e: React.FormEvent): void {
    e.preventDefault();
    const text = draft.trim();
    if (!text || !auth.token) return;
    const sock = getSocket(auth.token);
    sock.emit(SOCKET_EVENTS.CHAT_SEND, { content: text.slice(0, 200), type: 'text' });
    setDraft('');
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <div
        ref={listRef}
        className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-2 text-sm"
        aria-live="polite"
      >
        {messages.length === 0 ? (
          <div className="text-muted text-xs text-center py-6">
            No messages yet. Say hi!
          </div>
        ) : (
          messages.map((m) => {
            const mine = m.userId === auth.userId;
            return (
              <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[85%] rounded-lg px-3 py-1.5 ${
                    mine
                      ? 'bg-accent/20 text-text'
                      : m.isSpectator
                        ? 'bg-canvas text-muted italic'
                        : 'bg-line text-text'
                  }`}
                >
                  <div className="text-[10px] uppercase tracking-wider text-muted mb-0.5">
                    {m.username}
                    {m.isSpectator && ' · spec'}
                  </div>
                  <div className="break-words">{m.content}</div>
                </div>
              </div>
            );
          })
        )}
      </div>
      <form onSubmit={send} className="mt-2 flex gap-2">
        <input
          data-testid="chat-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={200}
          placeholder="Say something..."
          aria-label="Chat message"
          className="flex-1 bg-canvas border border-line rounded-md px-3 py-1.5 text-sm focus:outline-none focus:border-accent"
        />
        <button
          data-testid="chat-send"
          type="submit"
          disabled={!draft.trim()}
          className="bg-accent text-ink font-semibold px-3 py-1.5 rounded-md text-sm disabled:opacity-40"
        >
          Send
        </button>
      </form>
    </div>
  );
}
