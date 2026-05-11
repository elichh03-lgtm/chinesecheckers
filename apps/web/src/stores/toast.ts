import { create } from 'zustand';

export type ToastKind = 'info' | 'success' | 'warn' | 'error';

export type Toast = {
  id: string;
  kind: ToastKind;
  message: string;
  ttlMs: number;
};

type ToastState = {
  toasts: Toast[];
  push: (t: Omit<Toast, 'id' | 'ttlMs'> & { ttlMs?: number }) => string;
  dismiss: (id: string) => void;
};

let counter = 0;

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (input) => {
    const id = `t_${++counter}`;
    const t: Toast = { id, ttlMs: 4000, ...input };
    set((s) => ({ toasts: [...s.toasts, t] }));
    if (t.ttlMs > 0) {
      setTimeout(() => {
        set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) }));
      }, t.ttlMs);
    }
    return id;
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

export const toast = {
  info: (msg: string, ttlMs?: number) => useToastStore.getState().push({ kind: 'info', message: msg, ttlMs }),
  success: (msg: string, ttlMs?: number) => useToastStore.getState().push({ kind: 'success', message: msg, ttlMs }),
  warn: (msg: string, ttlMs?: number) => useToastStore.getState().push({ kind: 'warn', message: msg, ttlMs }),
  error: (msg: string, ttlMs?: number) => useToastStore.getState().push({ kind: 'error', message: msg, ttlMs }),
};
