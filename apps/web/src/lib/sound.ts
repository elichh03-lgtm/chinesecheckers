const MUTED_KEY = 'cc.sound.muted';
const VOLUME_KEY = 'cc.sound.volume';

type SoundName = 'move' | 'win' | 'tick';

const SOURCES: Record<SoundName, string> = {
  move: '/sfx/move.mp3',
  win: '/sfx/win.mp3',
  tick: '/sfx/tick.mp3',
};

type Slot = { audio: HTMLAudioElement; enabled: boolean };
const slots: Partial<Record<SoundName, Slot>> = {};

const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function getMuted(): boolean {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem(MUTED_KEY) === 'true';
}

export function setMuted(v: boolean): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(MUTED_KEY, v ? 'true' : 'false');
  applyVolume();
  emit();
}

export function getVolume(): number {
  if (typeof window === 'undefined') return 0.5;
  const raw = window.localStorage.getItem(VOLUME_KEY);
  const n = raw == null ? 0.5 : Number(raw);
  if (Number.isNaN(n)) return 0.5;
  return Math.max(0, Math.min(1, n));
}

export function setVolume(v: number): void {
  if (typeof window === 'undefined') return;
  const clamped = Math.max(0, Math.min(1, v));
  window.localStorage.setItem(VOLUME_KEY, String(clamped));
  applyVolume();
  emit();
}

function applyVolume(): void {
  const v = getMuted() ? 0 : getVolume();
  for (const slot of Object.values(slots)) {
    if (slot) slot.audio.volume = v;
  }
}

function init(): void {
  if (typeof window === 'undefined') return;
  if (Object.keys(slots).length > 0) return;
  for (const name of Object.keys(SOURCES) as SoundName[]) {
    try {
      const audio = new Audio(SOURCES[name]);
      audio.preload = 'auto';
      audio.volume = getMuted() ? 0 : getVolume();
      const slot: Slot = { audio, enabled: true };
      audio.addEventListener('error', () => {
        slot.enabled = false;
      });
      slots[name] = slot;
    } catch {
      // ignore — playback for this sound becomes a no-op
    }
  }
}

function play(name: SoundName): void {
  if (typeof window === 'undefined') return;
  init();
  if (getMuted()) return;
  const slot = slots[name];
  if (!slot || !slot.enabled) return;
  try {
    slot.audio.currentTime = 0;
    const p = slot.audio.play();
    if (p && typeof p.catch === 'function') {
      p.catch(() => {
        // Autoplay blocked or file missing — disable to avoid console noise.
        slot.enabled = false;
      });
    }
  } catch {
    slot.enabled = false;
  }
}

export function playMove(): void {
  play('move');
}

export function playWin(): void {
  play('win');
}

let lastTickKey: string | null = null;

export function playTick(key: string): void {
  if (lastTickKey === key) return;
  lastTickKey = key;
  play('tick');
}

export function resetTick(): void {
  lastTickKey = null;
}
