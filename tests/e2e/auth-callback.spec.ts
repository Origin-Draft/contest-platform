/**
 * Auth callback regression tests — covers the two Supabase-specific callback
 * paths that were broken before the fix in auth.ts, plus the nav profile pill.
 *
 *   1. Nav profile pill: after a successful email/password sign-in the nav
 *      must render a visible pill (avatar initial + display name) instead of
 *      the previous invisible text span.
 *
 *   2. Server-generated PKCE code callback: Supabase sends ?code=... without a
 *      state param (no client-initiated PKCE session). Previously threw
 *      "Missing OIDC callback state. Please sign in again."
 *
 *   3. Hash-fragment token callback: Supabase sends #access_token=... for
 *      older / implicit-style email confirmations. Previously ignored
 *      entirely, leaving the user stuck on "Completing sign-in…".
 *
 *   4. Invalid code shows a human-readable error with a "Return home" link
 *      (regression guard — must not crash or loop).
 */

import { expect, test } from '@playwright/test';

const supabaseMockPort = Number(process.env.PLAYWRIGHT_SUPABASE_MOCK_PORT ?? 54321);
const entrantEmail = process.env.PLAYWRIGHT_ENTRANT_EMAIL ?? 'entrant-smoke@origin-draft.test';
const entrantPassword = process.env.PLAYWRIGHT_ENTRANT_PASSWORD ?? 'EntrantSmoke123!';
const entrantDisplayName = 'Entrant Smoke';

async function getTestToken(email: string): Promise<{ access_token: string; refresh_token: string; expires_in: number }> {
  const resp = await fetch(
    `http://127.0.0.1:${supabaseMockPort}/auth/v1/test/signed-token?email=${encodeURIComponent(email)}`,
  );
  if (!resp.ok) {
    throw new Error(`Could not get test token for ${email}: ${resp.status}`);
  }
  return resp.json() as Promise<{ access_token: string; refresh_token: string; expires_in: number }>;
}

test.describe('Auth callback — nav profile pill', () => {
  test('nav shows avatar initial and display name after email/password sign-in', async ({ page }) => {
    await page.goto('/login');

    await page.getByLabel('Email').fill(entrantEmail);
    await page.getByLabel('Password', { exact: true }).fill(entrantPassword);
    await page.locator('form.stack-form button[type="submit"]').click();

    await expect(page).toHaveURL((url) => url.pathname === '/', { timeout: 15_000 });

    // Pill container
    await expect(page.locator('.nav-user-pill')).toBeVisible({ timeout: 10_000 });

    // Avatar circle contains the first initial
    await expect(page.locator('.nav-user-avatar')).toBeVisible();
    await expect(page.locator('.nav-user-avatar')).toHaveText(entrantDisplayName.charAt(0).toUpperCase());

    // Display name label
    await expect(page.locator('.nav-user-name')).toBeVisible();
    await expect(page.locator('.nav-user-name')).toContainText(entrantDisplayName);

    // Sign Out button present; Sign In button absent
    await expect(page.getByRole('button', { name: /sign out/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /^sign in$/i })).not.toBeVisible();
  });
});

test.describe('Auth callback — server-generated PKCE code', () => {
  test('?code=confirm-{email} without state param signs the user in', async ({ page }) => {
    // Simulates what Supabase sends when a user clicks a confirmation email link:
    // the server generates a PKCE code server-side with no matching client session.
    const code = `confirm-${entrantEmail}`;

    await page.goto(`/auth/callback?code=${encodeURIComponent(code)}`);

    // Should complete exchange and redirect home
    await expect(page).toHaveURL((url) => url.pathname === '/', { timeout: 20_000 });
    await expect(page.locator('.nav-user-pill')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('button', { name: /sign out/i })).toBeVisible();
  });

  test('?code=invalid-code without state shows a human-readable error', async ({ page }) => {
    await page.goto('/auth/callback?code=invalid-nonexistent-code');

    // AuthCallbackPage renders auth.error via .status-error — must not crash or loop
    await expect(page.locator('.status-error')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('.status-error')).toContainText(
      /could not complete sign-in|invalid.*code|expired/i,
    );

    // "Return home" must always be present so the user can escape
    await expect(page.getByRole('link', { name: /return home/i })).toBeVisible();
  });
});

test.describe('Auth callback — hash-fragment token', () => {
  test('#access_token=... in the URL fragment signs the user in', async ({ page }) => {
    // Simulates the older Supabase implicit-style email confirmation:
    // /auth/callback#access_token=...&refresh_token=...&expires_in=3600
    const { access_token, refresh_token, expires_in } = await getTestToken(entrantEmail);

    const fragment = [
      `access_token=${encodeURIComponent(access_token)}`,
      `refresh_token=${encodeURIComponent(refresh_token)}`,
      `expires_in=${expires_in}`,
      'token_type=bearer',
    ].join('&');

    await page.goto(`/auth/callback#${fragment}`);

    await expect(page).toHaveURL((url) => url.pathname === '/', { timeout: 20_000 });
    await expect(page.locator('.nav-user-pill')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('button', { name: /sign out/i })).toBeVisible();
  });
});
