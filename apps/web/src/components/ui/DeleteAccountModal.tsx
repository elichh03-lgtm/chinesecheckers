import { useState } from 'react';
import { api } from '@/api/client';

type Props = {
  onCancel: () => void;
  onDeleted: () => void;
};

const CONFIRM_PHRASE = 'DELETE my account';

export function DeleteAccountModal({ onCancel, onDeleted }: Props): JSX.Element {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const canSubmit = password.length > 0 && confirm === CONFIRM_PHRASE && !busy;

  async function submit(): Promise<void> {
    if (!canSubmit) return;
    setBusy(true);
    setErr(null);
    try {
      await api.delete('/me', { data: { password } });
      onDeleted();
    } catch (e) {
      const code = (e as { response?: { status?: number } }).response?.status;
      setErr(code === 401 ? 'Wrong password.' : 'Could not delete account.');
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
      onClick={onCancel}
    >
      <div
        className="bg-panel border border-line rounded-xl p-6 max-w-md w-full mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-display text-xl font-bold mb-2">Delete account</h2>
        <p className="text-sm text-muted mb-4">
          This will permanently remove your account. Game history is preserved for other
          players but your name is anonymized. This cannot be undone.
        </p>

        <label className="block text-sm mb-2">
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full bg-canvas border border-line rounded-md p-2 text-sm"
            autoFocus
          />
        </label>

        <label className="block text-sm mb-4">
          Type <code className="text-accent">{CONFIRM_PHRASE}</code> to confirm
          <input
            type="text"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="mt-1 w-full bg-canvas border border-line rounded-md p-2 text-sm"
          />
        </label>

        {err && <p className="text-red text-sm mb-3">{err}</p>}

        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm text-muted hover:text-text"
            disabled={busy}
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!canSubmit}
            className="px-4 py-2 text-sm bg-red text-white rounded-md disabled:opacity-50"
          >
            {busy ? 'Deleting…' : 'Delete my account'}
          </button>
        </div>
      </div>
    </div>
  );
}
