import { createHash } from 'node:crypto';

/**
 * HIBP k-anonymity password breach check.
 *
 * SHA-1 the password, send the first 5 hex chars to the range API, look for
 * the remaining suffix in the response. Returns `true` only when the suffix
 * appears with `count >= MIN_COUNT`. Fail open on timeout / network error /
 * unexpected status — never block a registration because HIBP is down.
 */

const ENDPOINT = 'https://api.pwnedpasswords.com/range/';
const TIMEOUT_MS = 3000;
const MIN_COUNT = 10;

export async function isPwned(password: string): Promise<boolean> {
  try {
    const sha1 = createHash('sha1').update(password).digest('hex').toUpperCase();
    const prefix = sha1.slice(0, 5);
    const suffix = sha1.slice(5);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let resp: Response;
    try {
      resp = await fetch(ENDPOINT + prefix, {
        signal: controller.signal,
        headers: { 'Add-Padding': 'true', 'User-Agent': 'cc-checkers-hibp' },
      });
    } finally {
      clearTimeout(timer);
    }
    if (!resp.ok) return false;
    const text = await resp.text();
    for (const line of text.split(/\r?\n/)) {
      const [s, c] = line.split(':');
      if (!s || !c) continue;
      if (s.trim().toUpperCase() === suffix) {
        const count = Number.parseInt(c.trim(), 10);
        return Number.isFinite(count) && count >= MIN_COUNT;
      }
    }
    return false;
  } catch {
    return false;
  }
}
