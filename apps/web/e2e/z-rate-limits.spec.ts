import { test, expect } from '@playwright/test';

// Filename prefixed `z-` so this runs LAST alphabetically. The auth limiter is
// per-IP and the saturation it produces would block subsequent test files
// that hit /auth/login or /auth/register from the same Playwright runner IP.

test('login endpoint rate-limits after the per-minute cap', async ({ page }) => {
  const responses: number[] = [];
  for (let i = 0; i < 60; i++) {
    const res = await page.request.post('http://localhost:3001/api/v1/auth/login', {
      data: { username: 'nobody_exists_xyz', password: 'wrong_password_12345' },
      headers: { 'content-type': 'application/json' },
    });
    responses.push(res.status());
  }
  expect(responses).toContain(429);
});
