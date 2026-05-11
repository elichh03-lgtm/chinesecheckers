import { describe, expect, it } from 'vitest';
import { hashPassword, signToken, verifyPassword, verifyToken } from '../auth.js';

describe('auth tokens (JWT)', () => {
  it('round-trips a valid token', () => {
    const t = signToken('user_123');
    expect(verifyToken(t)).toBe('user_123');
  });

  it('rejects a token with a tampered payload', () => {
    const t = signToken('user_123');
    const tampered = t.slice(0, -2) + 'AA';
    expect(verifyToken(tampered)).toBeNull();
  });

  it('rejects an expired token', () => {
    const t = signToken('user_expired', -1000);
    expect(verifyToken(t)).toBeNull();
  });

  it('rejects garbage', () => {
    expect(verifyToken('not_a_token')).toBeNull();
    expect(verifyToken('a.b')).toBeNull();
    expect(verifyToken('')).toBeNull();
  });
});

describe('password hashing', () => {
  it('hashes and verifies', async () => {
    const hash = await hashPassword('correctHorseBatteryStaple');
    expect(await verifyPassword('correctHorseBatteryStaple', hash)).toBe(true);
    expect(await verifyPassword('wrong', hash)).toBe(false);
  });

  it('produces different hashes for the same password (salt)', async () => {
    const a = await hashPassword('same');
    const b = await hashPassword('same');
    expect(a).not.toBe(b);
  });
});
