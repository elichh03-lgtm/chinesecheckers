const ANNOUNCE_KEY = 'cc.settings.announceMoves';

const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

export function subscribeSettings(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function getAnnounceMoves(): boolean {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem(ANNOUNCE_KEY) === 'true';
}

export function setAnnounceMoves(v: boolean): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(ANNOUNCE_KEY, v ? 'true' : 'false');
  emit();
}
