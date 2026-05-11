import { test, expect, type Page } from '@playwright/test';

/**
 * End-to-end smoke covering the Track A success criteria from the plan:
 *   1. Two real users sign in
 *   2. Game starts within 1s of the second join
 *   3. Both clients see the canvas board and turn indicator
 *
 * Move-level interaction (clicking specific marbles) is intentionally not
 * exercised here — canvas pixel hit-testing is brittle as a smoke. The
 * server-side socket integration test covers the move/confirm contract.
 */

async function signIn(page: Page, username: string): Promise<void> {
  await page.goto('/');
  // Default mode is "Sign up" which calls /auth/register
  await page.getByTestId('username-input').fill(username);
  await page.getByTestId('password-input').fill('test_password_123');
  await page.getByTestId('enter-lobby-btn').click();
  await expect(page).toHaveURL(/\/lobby$/);
}

test('two players sign in, create + join a 2P room, game starts on both clients', async ({
  browser,
}) => {
  const stamp = Date.now().toString(36);
  const aliceName = `alice_${stamp}`;
  const bobName = `bob_${stamp}`;
  const roomName = `e2e_${stamp}`;

  const aliceCtx = await browser.newContext();
  const bobCtx = await browser.newContext();
  const alice = await aliceCtx.newPage();
  const bob = await bobCtx.newPage();

  await signIn(alice, aliceName);
  await signIn(bob, bobName);

  // Alice creates a 2P room
  await alice.getByTestId('new-room-btn').click();
  await alice.locator('input').first().fill(roomName); // overwrite default
  // (player count defaults to 2, timer to 60 — fine)
  await alice.getByTestId('create-room-submit').click();
  await expect(alice).toHaveURL(/\/game\/[a-zA-Z0-9_-]+/);

  // Bob: lobby polls every 2s; wait for the room row, then click it
  await bob.getByTestId(`room-row-${roomName}`).click({ timeout: 10_000 });
  await expect(bob).toHaveURL(/\/game\/[a-zA-Z0-9_-]+/);

  // Both see the turn indicator (only rendered when game.status === 'active')
  await expect(alice.getByTestId('turn-indicator')).toBeVisible({ timeout: 5_000 });
  await expect(bob.getByTestId('turn-indicator')).toBeVisible({ timeout: 5_000 });

  // Exactly one of them is the active mover; both indicators reflect the same turn.
  const aliceTurn = await alice.getByTestId('turn-indicator').textContent();
  const bobTurn = await bob.getByTestId('turn-indicator').textContent();
  const exactlyOneIsMine =
    (aliceTurn === 'Your move' && bobTurn?.startsWith('Waiting')) ||
    (bobTurn === 'Your move' && aliceTurn?.startsWith('Waiting'));
  expect(exactlyOneIsMine).toBe(true);

  // Canvas is rendered on both
  await expect(alice.locator('canvas')).toBeVisible();
  await expect(bob.locator('canvas')).toBeVisible();

  await aliceCtx.close();
  await bobCtx.close();
});

test('player makes a move that the other client confirms', async ({ browser }) => {
  const stamp = Date.now().toString(36);
  const aliceName = `am_${stamp}`;
  const bobName = `bm_${stamp}`;
  const roomName = `mv_${stamp}`;

  const aliceCtx = await browser.newContext();
  const bobCtx = await browser.newContext();
  const alice = await aliceCtx.newPage();
  const bob = await bobCtx.newPage();
  await signIn(alice, aliceName);
  await signIn(bob, bobName);

  await alice.getByTestId('new-room-btn').click();
  await alice.locator('input').first().fill(roomName);
  await alice.getByTestId('create-room-submit').click();
  await expect(alice).toHaveURL(/\/game\/[a-zA-Z0-9_-]+/);
  await bob.getByTestId(`room-row-${roomName}`).click({ timeout: 10_000 });

  await expect(alice.getByTestId('turn-indicator')).toBeVisible({ timeout: 5_000 });
  await expect(bob.getByTestId('turn-indicator')).toBeVisible({ timeout: 5_000 });

  // Whoever's "Your move" goes first. Find them and click a known-valid hex.
  const whoMoves = (await alice.getByTestId('turn-indicator').textContent()) === 'Your move'
    ? alice
    : bob;
  const otherClient = whoMoves === alice ? bob : alice;

  // Click the canvas at the pixel position of cell (1, -5) — bottom-row of player
  // 0's home triangle. Then click (0, -4) — adjacent empty cell in the center.
  // Compute pixel coords from container: size = min(W,H)/20, origin = (W/2, H/2).
  const pixel = await whoMoves.evaluate(() => {
    const container = document.querySelector('canvas')?.parentElement;
    if (!container) return null;
    const rect = container.getBoundingClientRect();
    const size = Math.min(rect.width, rect.height) / 20;
    const ox = rect.left + rect.width / 2;
    const oy = rect.top + rect.height / 2;
    const SQRT3 = Math.sqrt(3);
    function hexToPx(q: number, r: number): { x: number; y: number } {
      return { x: ox + size * SQRT3 * (q + r / 2), y: oy + size * 1.5 * r };
    }
    // Try every hex in player 0's home base row + center neighbors;
    // pick (1,-5) → (0,-4) which is a known valid single step on a fresh board.
    return {
      from: hexToPx(1, -5),
      to: hexToPx(0, -4),
    };
  });
  expect(pixel).not.toBeNull();

  // Two-step: click marble, then click destination.
  await whoMoves.mouse.click(pixel!.from.x, pixel!.from.y);
  // Slight delay for preview to come back.
  await whoMoves.waitForTimeout(150);
  await whoMoves.mouse.click(pixel!.to.x, pixel!.to.y);

  // Both clients should now show that the OTHER player has the turn.
  await expect.poll(
    async () => (await whoMoves.getByTestId('turn-indicator').textContent()) ?? '',
    { timeout: 3_000 },
  ).not.toBe('Your move');
  await expect.poll(
    async () => (await otherClient.getByTestId('turn-indicator').textContent()) ?? '',
    { timeout: 3_000 },
  ).toBe('Your move');

  await aliceCtx.close();
  await bobCtx.close();
});

test('chat: a message from one player appears on the other client', async ({ browser }) => {
  const stamp = Date.now().toString(36);
  const aliceName = `ac_${stamp}`;
  const bobName = `bc_${stamp}`;
  const roomName = `ch_${stamp}`;

  const aliceCtx = await browser.newContext();
  const bobCtx = await browser.newContext();
  const alice = await aliceCtx.newPage();
  const bob = await bobCtx.newPage();
  await signIn(alice, aliceName);
  await signIn(bob, bobName);

  await alice.getByTestId('new-room-btn').click();
  await alice.locator('input').first().fill(roomName);
  await alice.getByTestId('create-room-submit').click();
  await expect(alice).toHaveURL(/\/game\/[a-zA-Z0-9_-]+/);
  await bob.getByTestId(`room-row-${roomName}`).click({ timeout: 10_000 });

  await expect(alice.getByTestId('turn-indicator')).toBeVisible({ timeout: 5_000 });
  await expect(bob.getByTestId('turn-indicator')).toBeVisible({ timeout: 5_000 });

  // Open chat tab on both sides.
  await alice.getByTestId('tab-chat').click();
  await bob.getByTestId('tab-chat').click();

  await alice.getByTestId('chat-input').fill('hello from alice');
  await alice.getByTestId('chat-send').click();

  // Message shows up on bob's screen
  await expect(bob.getByText('hello from alice')).toBeVisible({ timeout: 3_000 });

  await aliceCtx.close();
  await bobCtx.close();
});

test('replay page redirects to lobby for an unknown game id', async ({ page }) => {
  const stamp = Date.now().toString(36);
  await signIn(page, `re_${stamp}`);
  await page.goto('/replay/nonexistent_id_xyz');
  // Page initially loads (Replay does API fetch → on 404 navigates to /lobby)
  await expect(page).toHaveURL(/\/lobby$/, { timeout: 5_000 });
});
