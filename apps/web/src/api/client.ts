import axios from 'axios';
import { useAuthStore } from '@/stores/auth';

export const api = axios.create({
  baseURL: '/api/v1',
  withCredentials: true,
});

function readCookie(name: string): string | null {
  const target = name + '=';
  for (const raw of document.cookie.split(';')) {
    const c = raw.trim();
    if (c.startsWith(target)) return decodeURIComponent(c.slice(target.length));
  }
  return null;
}

// Attach the current access token as a Bearer header on every request.
api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token;
  if (token) {
    config.headers = config.headers ?? {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

let refreshing: Promise<string | null> | null = null;

async function tryRefresh(): Promise<string | null> {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    try {
      const csrf = readCookie('csrf');
      const { data } = await axios.post(
        '/api/v1/auth/refresh',
        {},
        {
          withCredentials: true,
          headers: csrf ? { 'x-csrf': csrf } : undefined,
        },
      );
      useAuthStore.getState().setAuth({
        userId: data.user.id,
        username: data.user.username,
        token: data.token,
      });
      return data.token as string;
    } catch {
      useAuthStore.getState().logout();
      return null;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

api.interceptors.response.use(
  (r) => r,
  async (error) => {
    const original = error.config;
    if (error.response?.status === 401 && original && !original._retried) {
      original._retried = true;
      const newToken = await tryRefresh();
      if (newToken) return api(original);
    }
    throw error;
  },
);
