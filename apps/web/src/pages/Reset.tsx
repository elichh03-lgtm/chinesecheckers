import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '@/api/client';
import { toast } from '@/stores/toast';

export function Reset(): JSX.Element {
  const [params] = useSearchParams();
  const token = useMemo(() => params.get('token') ?? '', [params]);
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => navigate('/lobby'), 1500);
    return () => clearTimeout(t);
  }, [done, navigate]);

  async function onSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setErr(null);
    if (!token) {
      setErr('Missing or invalid reset token.');
      return;
    }
    if (newPassword !== confirm) {
      setErr('Passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      await api.post('/auth/reset', { token, newPassword });
      setDone(true);
      toast.success('Password updated. Redirecting…');
    } catch (e2: unknown) {
      const msg = (() => {
        if (typeof e2 === 'object' && e2 !== null && 'response' in e2) {
          const resp = (e2 as { response?: { data?: { error?: string } } }).response;
          const code = resp?.data?.error;
          if (code === 'INVALID_OR_EXPIRED_TOKEN') return 'This reset link is invalid or expired.';
          if (code === 'PASSWORD_BREACHED') return 'That password has appeared in a public breach. Pick another.';
          if (code === 'INVALID_PAYLOAD') return 'Password must be at least 8 characters.';
          if (code) return code;
        }
        return 'Something went wrong.';
      })();
      setErr(msg);
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-ink">
        <div className="w-full max-w-sm bg-panel/80 rounded-2xl p-8 border border-line">
          <h1 className="font-display text-2xl font-bold mb-2">Invalid link</h1>
          <p className="text-muted text-sm mb-4">This reset link is missing a token.</p>
          <Link to="/forgot" className="text-accent hover:underline">Request a new one</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-ink">
      <div className="w-full max-w-sm bg-panel/80 backdrop-blur rounded-2xl p-8 border border-line shadow-2xl">
        <h1 className="font-display text-2xl font-bold mb-1">Choose a new password</h1>
        <p className="text-muted text-sm mb-6">Pick something at least 8 characters long.</p>
        <form onSubmit={onSubmit} className="space-y-4" data-testid="reset-form">
          <div>
            <label htmlFor="newPassword" className="block text-xs font-medium uppercase tracking-wider text-muted mb-1.5">
              New password
            </label>
            <input
              id="newPassword"
              data-testid="reset-new-password"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full bg-canvas border border-line rounded-md px-3 py-2.5 text-text focus:outline-none focus:border-accent"
              minLength={8}
              maxLength={100}
              autoComplete="new-password"
              required
            />
          </div>
          <div>
            <label htmlFor="confirm" className="block text-xs font-medium uppercase tracking-wider text-muted mb-1.5">
              Confirm password
            </label>
            <input
              id="confirm"
              data-testid="reset-confirm-password"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="w-full bg-canvas border border-line rounded-md px-3 py-2.5 text-text focus:outline-none focus:border-accent"
              minLength={8}
              maxLength={100}
              autoComplete="new-password"
              required
            />
          </div>
          {err && (
            <p role="alert" data-testid="reset-error" className="text-red text-sm">{err}</p>
          )}
          {done && (
            <p role="status" data-testid="reset-success" className="text-green-400 text-sm">
              Password updated. Redirecting to lobby…
            </p>
          )}
          <button
            type="submit"
            data-testid="reset-submit-btn"
            disabled={busy || done}
            className="w-full bg-accent hover:bg-accent/90 disabled:opacity-60 text-ink font-semibold py-2.5 rounded-md transition"
          >
            {busy ? '...' : 'Update password'}
          </button>
        </form>
        <p className="text-xs text-muted text-center mt-6">
          <Link to="/" className="hover:text-text">Back to sign in</Link>
        </p>
      </div>
    </div>
  );
}
