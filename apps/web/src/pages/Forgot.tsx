import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/api/client';
import { toast } from '@/stores/toast';

export function Forgot(): JSX.Element {
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function onSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post('/auth/forgot', { username });
      setSent(true);
      toast.success("If that username exists, we've sent reset instructions");
    } catch {
      setSent(true);
      toast.success("If that username exists, we've sent reset instructions");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-ink">
      <div className="w-full max-w-sm bg-panel/80 backdrop-blur rounded-2xl p-8 border border-line shadow-2xl">
        <h1 className="font-display text-2xl font-bold mb-1">Forgot password</h1>
        <p className="text-muted text-sm mb-6">
          Enter your username and we&apos;ll email you a reset link.
        </p>
        <form onSubmit={onSubmit} className="space-y-4" data-testid="forgot-form">
          <div>
            <label htmlFor="username" className="block text-xs font-medium uppercase tracking-wider text-muted mb-1.5">
              Username
            </label>
            <input
              id="username"
              data-testid="forgot-username-input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full bg-canvas border border-line rounded-md px-3 py-2.5 text-text focus:outline-none focus:border-accent"
              minLength={2}
              maxLength={20}
              pattern="[a-zA-Z0-9_]+"
              autoComplete="username"
              required
            />
          </div>
          <button
            type="submit"
            data-testid="forgot-submit-btn"
            disabled={busy}
            className="w-full bg-accent hover:bg-accent/90 disabled:opacity-60 text-ink font-semibold py-2.5 rounded-md transition"
          >
            {busy ? '...' : 'Send reset link'}
          </button>
          {sent && (
            <p role="status" data-testid="forgot-sent-msg" className="text-sm text-muted">
              If that username exists, we&apos;ve sent reset instructions.
            </p>
          )}
        </form>
        <p className="text-xs text-muted text-center mt-6">
          <Link to="/" className="hover:text-text">Back to sign in</Link>
        </p>
      </div>
    </div>
  );
}
