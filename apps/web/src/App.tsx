import { lazy, Suspense, useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Landing } from '@/pages/Landing';
import { Lobby } from '@/pages/Lobby';
import { Game } from '@/pages/Game';
import { RouteLoadingSkeleton } from '@/components/ui/RouteLoadingSkeleton';
import { Toaster } from '@/components/ui/Toaster';
import { useAuthStore } from '@/stores/auth';
import { toast } from '@/stores/toast';

const Replay = lazy(() => import('@/pages/Replay').then((m) => ({ default: m.Replay })));
const Profile = lazy(() => import('@/pages/Profile').then((m) => ({ default: m.Profile })));
const EditProfile = lazy(() =>
  import('@/pages/EditProfile').then((m) => ({ default: m.EditProfile })),
);
const Leaderboard = lazy(() =>
  import('@/pages/Leaderboard').then((m) => ({ default: m.Leaderboard })),
);
const Forgot = lazy(() => import('@/pages/Forgot').then((m) => ({ default: m.Forgot })));
const Reset = lazy(() => import('@/pages/Reset').then((m) => ({ default: m.Reset })));

function useOAuthHashPickup(): void {
  const setAuth = useAuthStore((s) => s.setAuth);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const hash = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : '';
    if (!hash) {
      const search = new URLSearchParams(window.location.search);
      const oauthErr = search.get('oauth_error');
      if (oauthErr) {
        toast.error(`Google sign-in failed (${oauthErr}).`);
        const url = new URL(window.location.href);
        url.searchParams.delete('oauth_error');
        window.history.replaceState({}, '', url.toString());
      }
      return;
    }
    const params = new URLSearchParams(hash);
    const token = params.get('token');
    const userId = params.get('userId');
    const username = params.get('username');
    if (token && userId && username) {
      // Review fix: scrub OAuth tokens from the URL hash before doing anything
      // else, so a navigation race / reload / shared screenshot never exposes
      // them.
      window.history.replaceState(null, '', window.location.pathname);
      setAuth({ userId, username, token });
      toast.success(`Signed in as ${username}`);
    }
  }, [setAuth]);
}

export default function App(): JSX.Element {
  useOAuthHashPickup();
  return (
    <>
      <Suspense fallback={<RouteLoadingSkeleton />}>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/lobby" element={<Lobby />} />
          <Route path="/game/:gameId" element={<Game />} />
          <Route path="/replay/:gameId" element={<Replay />} />
          <Route path="/profile/edit" element={<EditProfile />} />
          <Route path="/profile/:username" element={<Profile />} />
          <Route path="/leaderboard" element={<Leaderboard />} />
          <Route path="/forgot" element={<Forgot />} />
          <Route path="/reset" element={<Reset />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
      <Toaster />
    </>
  );
}
