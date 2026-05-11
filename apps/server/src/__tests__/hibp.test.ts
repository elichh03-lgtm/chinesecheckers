import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { isPwned } from '../lib/hibp.js';

function suffixOf(password: string): string {
  return createHash('sha1').update(password).digest('hex').toUpperCase().slice(5);
}

describe('HIBP isPwned', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
  });

  it('returns true when the suffix appears with a high count', async () => {
    const pw = 'hunter2';
    const body = `${suffixOf(pw)}:50000\nABCDEF1234:7\n`;
    globalThis.fetch = vi.fn(async () => new Response(body, { status: 200 })) as typeof fetch;
    expect(await isPwned(pw)).toBe(true);
  });

  it('returns false when the suffix is absent', async () => {
    globalThis.fetch = vi.fn(
      async () => new Response('AAAAA1111:5\nBBBBB2222:10\n', { status: 200 }),
    ) as typeof fetch;
    expect(await isPwned('a-pretty-unique-password-xyzzy')).toBe(false);
  });

  it('returns false when the suffix appears but count < 10', async () => {
    const pw = 'lowcount';
    const body = `${suffixOf(pw)}:5\n`;
    globalThis.fetch = vi.fn(async () => new Response(body, { status: 200 })) as typeof fetch;
    expect(await isPwned(pw)).toBe(false);
  });

  it('fails open on fetch error', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('network down');
    }) as typeof fetch;
    expect(await isPwned('whatever')).toBe(false);
  });

  it('fails open on non-OK status', async () => {
    globalThis.fetch = vi.fn(async () => new Response('', { status: 500 })) as typeof fetch;
    expect(await isPwned('whatever')).toBe(false);
  });
});
