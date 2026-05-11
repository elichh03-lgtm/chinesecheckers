import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { useAuthStore } from '@/stores/auth';
import { toast } from '@/stores/toast';

type Mode = 'login' | 'register';

export function Landing(): JSX.Element {
  const { t } = useTranslation();
  const [mode, setMode] = useState<Mode>('register');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const setAuth = useAuthStore((s) => s.setAuth);
  const navigate = useNavigate();

  async function onGoogleClick(): Promise<void> {
    try {
      const { data } = await api.get<{ enabled: boolean }>('/auth/google/check');
      if (!data.enabled) {
        toast.warn(t('landing.googleNotConfigured'));
        return;
      }
      window.location.href = '/api/v1/auth/google';
    } catch {
      toast.error(t('landing.googleStartFailed'));
    }
  }

  async function onSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const path = mode === 'register' ? '/auth/register' : '/auth/login';
      const { data } = await api.post(path, { username, password });
      setAuth({
        userId: data.user.id,
        username: data.user.username,
        token: data.token,
      });
      toast.success(
        mode === 'register'
          ? t('landing.welcome', { username: data.user.username })
          : t('landing.welcomeBack', { username: data.user.username }),
      );
      navigate('/lobby');
    } catch (e2: unknown) {
      const msg = (() => {
        if (typeof e2 === 'object' && e2 !== null && 'response' in e2) {
          const resp = (e2 as { response?: { data?: { error?: string }; status?: number } }).response;
          if (resp?.status === 409) return t('landing.usernameTaken');
          if (resp?.status === 401) return t('landing.invalidCredentials');
          if (resp?.status === 429) return t('landing.tooManyAttempts');
          if (resp?.data?.error) return resp.data.error;
        }
        return t('common.errorGeneric');
      })();
      setErr(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden bg-ink">
      {/* Decorative star backdrop */}
      <Star className="absolute -top-32 -left-32 w-[480px] h-[480px] text-accent/10 rotate-12" />
      <Star className="absolute -bottom-40 -right-40 w-[640px] h-[640px] text-purple/5 -rotate-12" />

      <div className="relative w-full max-w-sm bg-panel/80 backdrop-blur rounded-2xl p-8 border border-line shadow-2xl animate-slide-up">
        <div className="flex items-center gap-2 mb-1">
          <Star className="w-7 h-7 text-accent" />
          <h1 className="font-display text-3xl font-bold tracking-tight">{t('app.name')}</h1>
        </div>
        <p className="text-muted text-sm mb-6">{t('app.tagline')}</p>

        <div className="flex gap-1 mb-5 p-1 bg-canvas rounded-lg text-sm">
          {(['register', 'login'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`flex-1 py-2 rounded-md transition ${
                mode === m
                  ? 'bg-accent text-ink font-semibold shadow-sm'
                  : 'text-muted hover:text-text'
              }`}
            >
              {m === 'register' ? t('common.signUp') : t('common.logIn')}
            </button>
          ))}
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label htmlFor="username" className="block text-xs font-medium uppercase tracking-wider text-muted mb-1.5">
              {t('common.username')}
            </label>
            <input
              id="username"
              data-testid="username-input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full bg-canvas border border-line rounded-md px-3 py-2.5 text-text placeholder:text-muted/60 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition"
              placeholder={t('landing.usernamePlaceholder')}
              minLength={2}
              maxLength={20}
              pattern="[a-zA-Z0-9_]+"
              autoComplete="username"
              required
            />
          </div>
          <div>
            <label htmlFor="password" className="block text-xs font-medium uppercase tracking-wider text-muted mb-1.5">
              {t('common.password')}
            </label>
            <input
              id="password"
              data-testid="password-input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-canvas border border-line rounded-md px-3 py-2.5 text-text placeholder:text-muted/60 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition"
              placeholder={t('landing.passwordPlaceholder')}
              minLength={8}
              maxLength={100}
              autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
              required
            />
          </div>
          {err && (
            <p role="alert" className="text-red text-sm flex items-center gap-2">
              <span aria-hidden>⚠</span> {err}
            </p>
          )}
          <button
            data-testid="enter-lobby-btn"
            type="submit"
            disabled={busy}
            className="w-full bg-accent hover:bg-accent/90 disabled:opacity-60 disabled:cursor-not-allowed text-ink font-semibold py-2.5 rounded-md transition shadow-sm"
          >
            {busy ? '...' : mode === 'register' ? t('common.createAccount') : t('common.logIn')}
          </button>
          {mode === 'login' && (
            <p className="text-xs text-muted text-center">
              <Link to="/forgot" data-testid="forgot-password-link" className="hover:text-text underline">
                {t('landing.forgotPassword')}
              </Link>
            </p>
          )}
        </form>

        <div className="my-5 flex items-center gap-3 text-xs text-muted">
          <span className="flex-1 h-px bg-line" />
          {t('common.or')}
          <span className="flex-1 h-px bg-line" />
        </div>

        <button
          type="button"
          data-testid="google-signin-btn"
          onClick={onGoogleClick}
          className="w-full flex items-center justify-center gap-2 bg-canvas hover:bg-canvas/70 border border-line text-text font-medium py-2.5 rounded-md transition"
        >
          <GoogleIcon className="w-5 h-5" />
          {t('landing.continueWithGoogle')}
        </button>

        <p className="text-xs text-muted text-center mt-6">
          {mode === 'register' ? t('landing.registerHint') : t('landing.loginHint')}
        </p>
      </div>
    </div>
  );
}

function GoogleIcon({ className }: { className?: string }): JSX.Element {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden focusable="false">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.6-6 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.5 29.3 4.5 24 4.5 12.7 4.5 3.5 13.7 3.5 25S12.7 45.5 24 45.5 44.5 36.3 44.5 25c0-1.5-.2-3-.4-4.5z"/>
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 16 19 13 24 13c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.5 29.3 4.5 24 4.5 16.3 4.5 9.7 8.7 6.3 14.7z"/>
      <path fill="#4CAF50" d="M24 45.5c5.2 0 9.9-2 13.5-5.2l-6.2-5.2c-1.9 1.3-4.4 2.1-7.3 2.1-5.3 0-9.7-3.4-11.3-8l-6.5 5C9.4 41 16.1 45.5 24 45.5z"/>
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4 5.5l6.2 5.2C40.2 36 44.5 30.5 44.5 25c0-1.5-.2-3-.4-4.5z"/>
    </svg>
  );
}

/** 6-pointed Star of David — the Sternhalma board silhouette. */
function Star({ className }: { className?: string }): JSX.Element {
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden focusable="false">
      <polygon
        points="50,5 61.8,38.2 95,38.2 68.6,58.8 80.4,92 50,71.4 19.6,92 31.4,58.8 5,38.2 38.2,38.2"
        fill="currentColor"
      />
    </svg>
  );
}
