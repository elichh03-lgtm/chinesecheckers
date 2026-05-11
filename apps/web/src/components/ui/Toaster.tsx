import { useToastStore, type ToastKind } from '@/stores/toast';

const kindStyles: Record<ToastKind, { bg: string; ring: string; icon: string }> = {
  info: { bg: 'bg-panel', ring: 'ring-line', icon: 'ℹ' },
  success: { bg: 'bg-green/15', ring: 'ring-green/40', icon: '✓' },
  warn: { bg: 'bg-yellow/15', ring: 'ring-yellow/40', icon: '!' },
  error: { bg: 'bg-red/15', ring: 'ring-red/40', icon: '×' },
};

export function Toaster(): JSX.Element {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);
  return (
    <div
      aria-live="polite"
      aria-atomic="false"
      className="fixed top-4 right-4 z-[100] flex flex-col gap-2 max-w-sm pointer-events-none"
    >
      {toasts.map((t) => {
        const s = kindStyles[t.kind];
        return (
          <button
            key={t.id}
            onClick={() => dismiss(t.id)}
            className={`pointer-events-auto flex items-start gap-3 px-4 py-3 rounded-lg ring-1 ${s.bg} ${s.ring} text-text text-sm text-left shadow-xl backdrop-blur animate-toast-in`}
          >
            <span className={`font-bold ${t.kind === 'success' ? 'text-green' : t.kind === 'warn' ? 'text-yellow' : t.kind === 'error' ? 'text-red' : 'text-accent'}`}>{s.icon}</span>
            <span className="flex-1">{t.message}</span>
          </button>
        );
      })}
    </div>
  );
}
