import { test, expect, type Page } from '@playwright/test';

async function signIn(page: Page, username: string): Promise<void> {
  await page.goto('/');
  await page.getByTestId('username-input').fill(username);
  await page.getByTestId('password-input').fill('test_password_123');
  await page.getByTestId('enter-lobby-btn').click();
  await expect(page).toHaveURL(/\/lobby$/);
}

test('mute toggle persists across reloads', async ({ page }) => {
  const stamp = Date.now().toString(36);
  await signIn(page, `mu_${stamp}`);

  const btn = page.getByTestId('mute-toggle');
  await expect(btn).toBeVisible();
  await expect(btn).toHaveAttribute('aria-pressed', 'false');

  await btn.click();
  await expect(btn).toHaveAttribute('aria-pressed', 'true');

  const stored = await page.evaluate(() => window.localStorage.getItem('cc.sound.muted'));
  expect(stored).toBe('true');

  await page.reload();
  await expect(page).toHaveURL(/\/lobby$/);
  const btn2 = page.getByTestId('mute-toggle');
  await expect(btn2).toHaveAttribute('aria-pressed', 'true');

  const storedAfter = await page.evaluate(() => window.localStorage.getItem('cc.sound.muted'));
  expect(storedAfter).toBe('true');
});
