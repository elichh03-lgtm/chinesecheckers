import { api } from './client';

export type SessionRow = {
  id: string;
  createdAt: string;
  lastUsedAt: string | null;
  current: boolean;
};

export async function listSessions(): Promise<SessionRow[]> {
  const { data } = await api.get<{ sessions: SessionRow[] }>('/me/sessions');
  return data.sessions;
}

export async function revokeSession(id: string): Promise<void> {
  await api.delete(`/me/sessions/${id}`);
}
