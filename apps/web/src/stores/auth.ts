import { create } from 'zustand';

type AuthState = {
  userId: string | null;
  username: string | null;
  token: string | null;
  setAuth: (data: { userId: string; username: string; token: string }) => void;
  logout: () => void;
};

const KEY = 'cc_auth';

function load(): { userId: string; username: string; token: string } | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<{
      userId: string;
      username: string;
      token: string;
    }>;
    if (parsed.userId && parsed.username && parsed.token) {
      return { userId: parsed.userId, username: parsed.username, token: parsed.token };
    }
    return null;
  } catch {
    return null;
  }
}

const initial = load();

export const useAuthStore = create<AuthState>((set) => ({
  userId: initial?.userId ?? null,
  username: initial?.username ?? null,
  token: initial?.token ?? null,
  setAuth: (data) => {
    localStorage.setItem(KEY, JSON.stringify(data));
    set({ userId: data.userId, username: data.username, token: data.token });
  },
  logout: () => {
    const token = (useAuthStore.getState as () => AuthState)().token;
    if (token) {
      // Fire-and-forget. Server clears HttpOnly cookie and revokes refresh tokens.
      fetch('/api/v1/auth/logout', {
        method: 'POST',
        credentials: 'include',
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => {
        /* swallow — UI logout still proceeds */
      });
    }
    localStorage.removeItem(KEY);
    set({ userId: null, username: null, token: null });
  },
}));
