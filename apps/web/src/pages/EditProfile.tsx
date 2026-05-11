import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/api/client';
import { useAuthStore } from '@/stores/auth';
import { toast } from '@/stores/toast';
import { COUNTRIES } from '@/lib/countries';

type Me = {
  id: string;
  username: string;
  email: string | null;
  avatarUrl: string | null;
  countryCode: string | null;
};

type AvatarPresign = {
  uploadUrl: string;
  publicUrl: string;
  key: string;
  contentType: string;
};

const ALLOWED_EXTS = ['png', 'jpg', 'jpeg', 'webp'];

function extOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase();
}

export function EditProfile(): JSX.Element {
  const navigate = useNavigate();
  const username = useAuthStore((s) => s.username);
  const userId = useAuthStore((s) => s.userId);
  const [me, setMe] = useState<Me | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [countryCode, setCountryCode] = useState<string>('');
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!userId) {
      navigate('/');
      return;
    }
    api
      .get<Me>('/me')
      .then((r) => {
        setMe(r.data);
        setAvatarUrl(r.data.avatarUrl);
        setCountryCode(r.data.countryCode ?? '');
      })
      .catch(() => setErr('Could not load profile.'));
  }, [userId, navigate]);

  async function uploadFile(file: File): Promise<void> {
    const ext = extOf(file.name);
    if (!ALLOWED_EXTS.includes(ext)) {
      toast.error('Use PNG, JPG, or WebP.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error('Max 5 MB.');
      return;
    }
    setUploading(true);
    try {
      const { data } = await api.post<AvatarPresign>('/me/avatar/upload-url', { ext });
      const putRes = await fetch(data.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': data.contentType },
        body: file,
      });
      if (!putRes.ok) throw new Error(`upload failed: ${putRes.status}`);
      setAvatarUrl(data.publicUrl);
      toast.success('Avatar uploaded.');
    } catch (e: unknown) {
      const status = (e as { response?: { status?: number } })?.response?.status;
      if (status === 501) {
        toast.warn('Avatar uploads are not configured on this server.');
      } else {
        toast.error('Avatar upload failed.');
      }
    } finally {
      setUploading(false);
    }
  }

  async function onSave(): Promise<void> {
    setSaving(true);
    try {
      await api.patch<Me>('/me', {
        ...(avatarUrl !== me?.avatarUrl && avatarUrl ? { avatarUrl } : {}),
        countryCode: countryCode === '' ? null : countryCode,
      });
      toast.success('Profile saved.');
      if (username) navigate(`/profile/${username}`);
      else navigate('/lobby');
    } catch {
      toast.error('Save failed.');
    } finally {
      setSaving(false);
    }
  }

  if (err) {
    return (
      <div className="min-h-screen bg-ink text-text p-8 text-center">
        <p>{err}</p>
        <button onClick={() => navigate('/lobby')} className="mt-4 text-accent hover:underline">
          Back to lobby
        </button>
      </div>
    );
  }
  if (!me) {
    return (
      <div className="min-h-screen bg-ink p-8">
        <div className="max-w-xl mx-auto space-y-6 animate-pulse-soft">
          <div className="skeleton h-8 w-48" />
          <div className="skeleton h-48 w-full rounded-xl" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-ink text-text p-8">
      <div className="max-w-xl mx-auto">
        <header className="flex items-center justify-between mb-6">
          <button onClick={() => navigate(-1)} className="text-muted hover:text-text">
            ← Back
          </button>
          <h1 className="font-display text-2xl font-bold">Edit profile</h1>
          <span className="w-12" />
        </header>

        <section className="bg-panel rounded-xl border border-line p-6 space-y-6">
          <div>
            <label className="block text-xs font-medium uppercase tracking-wider text-muted mb-2">
              Avatar
            </label>
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragActive(true);
              }}
              onDragLeave={() => setDragActive(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragActive(false);
                const file = e.dataTransfer.files[0];
                if (file) void uploadFile(file);
              }}
              onClick={() => fileInputRef.current?.click()}
              role="button"
              tabIndex={0}
              data-testid="avatar-dropzone"
              className={`flex items-center gap-4 p-4 rounded-md border-2 border-dashed cursor-pointer transition ${
                dragActive ? 'border-accent bg-accent/10' : 'border-line hover:border-accent/60'
              }`}
            >
              <div className="w-20 h-20 rounded-full bg-canvas border border-line overflow-hidden flex items-center justify-center text-muted">
                {avatarUrl ? (
                  <img src={avatarUrl} alt="avatar" className="w-full h-full object-cover" />
                ) : (
                  <span className="text-2xl">@</span>
                )}
              </div>
              <div className="text-sm">
                <p className="text-text font-medium">
                  {uploading ? 'Uploading…' : 'Drop an image or click to choose'}
                </p>
                <p className="text-xs text-muted mt-1">PNG, JPG, or WebP · max 5 MB</p>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void uploadFile(file);
                  e.target.value = '';
                }}
              />
            </div>
          </div>

          <div>
            <label htmlFor="country" className="block text-xs font-medium uppercase tracking-wider text-muted mb-2">
              Country
            </label>
            <select
              id="country"
              data-testid="country-select"
              value={countryCode}
              onChange={(e) => setCountryCode(e.target.value)}
              className="w-full bg-canvas border border-line rounded-md px-3 py-2.5 text-text focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition"
            >
              <option value="">— None —</option>
              {COUNTRIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name} ({c.code})
                </option>
              ))}
            </select>
          </div>

          <div className="flex gap-2 justify-end">
            <button
              type="button"
              onClick={() => navigate(-1)}
              className="px-4 py-2 text-muted hover:text-text"
            >
              Cancel
            </button>
            <button
              type="button"
              data-testid="save-profile-btn"
              onClick={onSave}
              disabled={saving || uploading}
              className="px-4 py-2 bg-accent hover:bg-accent/90 disabled:opacity-60 text-ink font-semibold rounded-md transition"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
