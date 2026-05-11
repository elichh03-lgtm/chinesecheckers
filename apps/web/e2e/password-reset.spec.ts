import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
// `pnpm --filter server dev` runs with cwd = apps/server, so the mailer writes
// to apps/server/.mail-outbox.jsonl.
const OUTBOX = resolve(HERE, '../../server/.mail-outbox.jsonl');

type OutboxEntry = {
  to?: string | { address: string }[];
  subject?: string;
  text?: string;
  html?: string;
  envelope?: { to: string[]; from: string };
};

function readOutbox(): OutboxEntry[] {
  if (!existsSync(OUTBOX)) return [];
  return readFileSync(OUTBOX, 'utf8')
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as OutboxEntry);
}

function findResetUrlFor(email: string): string | null {
  const entries = readOutbox().reverse();
  for (const e of entries) {
    const recipients: string[] = [];
    const t = e.to;
    if (typeof t === 'string') recipients.push(t);
    else if (Array.isArray(t)) recipients.push(...t.map((x) => x.address));
    recipients.push(...(e.envelope?.to ?? []));
    if (!recipients.includes(email)) continue;
    const body = `${e.text ?? ''}\n${e.html ?? ''}`;
    const m = body.match(/https?:\/\/[^\s"<]+\/reset\?token=[^\s"<]+/);
    if (m) return m[0];
  }
  return null;
}

test('forgot → reset → login with new password', async ({ page, request }) => {
  // Clear outbox to make matching deterministic.
  writeFileSync(OUTBOX, '', 'utf8');

  const stamp = Date.now().toString(36);
  const username = `pr_${stamp}`;
  const email = `pr_${stamp}@example.test`;
  const oldPassword = 'old_password_123';
  const newPassword = 'new_password_456';

  // Register with an email so the reset can be delivered.
  const reg = await request.post('/api/v1/auth/register', {
    data: { username, password: oldPassword, email },
  });
  expect(reg.ok()).toBe(true);

  // Hit forgot via the UI.
  await page.goto('/');
  // Switch to login mode so the "Forgot password?" link is visible.
  await page.getByRole('button', { name: 'Log in' }).first().click();
  await page.getByTestId('forgot-password-link').click();
  await expect(page).toHaveURL(/\/forgot$/);
  await page.getByTestId('forgot-username-input').fill(username);
  await page.getByTestId('forgot-submit-btn').click();
  await expect(page.getByTestId('forgot-sent-msg')).toBeVisible();

  // Poll the outbox until the email appears.
  let resetUrl: string | null = null;
  for (let i = 0; i < 30; i++) {
    resetUrl = findResetUrlFor(email);
    if (resetUrl) break;
    await page.waitForTimeout(200);
  }
  expect(resetUrl, 'reset email should arrive in jsonTransport outbox').not.toBeNull();

  // jsonTransport output should be valid JSON — verify the most recent entry parses.
  const entries = readOutbox();
  expect(entries.length).toBeGreaterThan(0);
  expect(entries[entries.length - 1].subject).toBeTruthy();

  // Follow the reset URL (strip origin so Playwright stays on baseURL).
  const tokenPath = new URL(resetUrl!).pathname + new URL(resetUrl!).search;
  await page.goto(tokenPath);
  await expect(page).toHaveURL(/\/reset\?token=/);

  await page.getByTestId('reset-new-password').fill(newPassword);
  await page.getByTestId('reset-confirm-password').fill(newPassword);
  await page.getByTestId('reset-submit-btn').click();
  await expect(page.getByTestId('reset-success')).toBeVisible();

  // Redirect lands on /lobby — but the user isn't logged in by reset alone.
  // Wait for the redirect, then go to landing to log in with the new password.
  await page.waitForURL(/\/(lobby|)$/);

  await page.goto('/');
  // Make sure we're in login mode.
  await page.getByRole('button', { name: 'Log in' }).first().click();
  await page.getByTestId('username-input').fill(username);
  await page.getByTestId('password-input').fill(newPassword);
  await page.getByTestId('enter-lobby-btn').click();
  await expect(page).toHaveURL(/\/lobby$/);

  // Old password should now fail.
  // (Use the API to avoid having to log out via UI.)
  const loginOld = await request.post('/api/v1/auth/login', {
    data: { username, password: oldPassword },
  });
  expect(loginOld.status()).toBe(401);
});
