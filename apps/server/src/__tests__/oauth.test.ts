import { describe, expect, it, beforeEach, afterAll } from 'vitest';
import { findOrCreateUserByGoogleId } from '../store.js';
import { prisma } from '../lib/prisma.js';
import { nanoid } from 'nanoid';

/**
 * Integration tests for the find-or-create-by-googleId helper. The Google
 * OAuth strategy is stubbed in test mode: rather than driving a real OAuth
 * dance, we exercise the store helper directly — that is the trust boundary
 * the route handler actually relies on.
 */

const ids: string[] = [];

function mkGoogleId(): string {
  const id = `gtest_${nanoid(10)}`;
  ids.push(id);
  return id;
}

afterAll(async () => {
  if (ids.length > 0) {
    await prisma.user.deleteMany({ where: { googleId: { in: ids } } });
  }
});

beforeEach(async () => {
  // ensure clean slate per test for the email scenarios
  await prisma.user.deleteMany({ where: { email: 'oauth_alice@example.com' } });
  await prisma.user.deleteMany({ where: { email: 'oauth_bob@example.com' } });
});

describe('findOrCreateUserByGoogleId', () => {
  it('creates a new user when the googleId is unseen', async () => {
    const googleId = mkGoogleId();
    const u = await findOrCreateUserByGoogleId(googleId, {
      email: 'oauth_alice@example.com',
      displayName: 'Alice',
      avatarUrl: 'https://example.com/a.png',
    });
    expect(u.id).toBeTruthy();
    expect(u.username.toLowerCase().startsWith('alice')).toBe(true);

    const persisted = await prisma.user.findUnique({ where: { id: u.id } });
    expect(persisted).not.toBeNull();
    expect(persisted!.googleId).toBe(googleId);
    expect(persisted!.email).toBe('oauth_alice@example.com');
    expect(persisted!.isGuest).toBe(false);
    expect(persisted!.avatarUrl).toBe('https://example.com/a.png');
  });

  it('returns the same user when the same googleId signs in again', async () => {
    const googleId = mkGoogleId();
    const a = await findOrCreateUserByGoogleId(googleId, {
      email: 'oauth_bob@example.com',
      displayName: 'Bob',
    });
    const b = await findOrCreateUserByGoogleId(googleId, {
      email: 'oauth_bob@example.com',
      displayName: 'Bob',
    });
    expect(b.id).toBe(a.id);
    expect(b.username).toBe(a.username);

    const all = await prisma.user.findMany({ where: { googleId } });
    expect(all).toHaveLength(1);
  });

  it('links a new googleId onto an existing email-matched account', async () => {
    // Pre-create a user with an email but no googleId (e.g. password user)
    const existing = await prisma.user.create({
      data: {
        username: `bob_${nanoid(4).toLowerCase()}`,
        email: 'oauth_bob@example.com',
        isGuest: false,
      },
    });

    const googleId = mkGoogleId();
    const linked = await findOrCreateUserByGoogleId(googleId, {
      email: 'oauth_bob@example.com',
      displayName: 'Bob',
    });
    expect(linked.id).toBe(existing.id);

    const reread = await prisma.user.findUnique({ where: { id: existing.id } });
    expect(reread!.googleId).toBe(googleId);
  });
});
