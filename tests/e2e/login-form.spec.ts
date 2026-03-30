/**
 * Login form UI tests — covers the improvements made to the /login page:
 *   - Styled email/password form renders at /login
 *   - Sign-up mode shows a confirm password field
 *   - Password strength is enforced client-side (min 8 chars, number or symbol)
 *   - Confirm password must match before the request is sent
 *   - Password fields are cleared after a failed sign-in attempt
 *   - Switching between sign-in and sign-up modes clears password fields
 *
 * These tests exercise the /login route directly and do not require a real
 * hosted authentication backend. Client-side validation runs before network
 * requests, and server-side failures are provided by the local e2e auth mock.
 */

import { expect, test } from '@playwright/test';

test.describe('Login page', () => {
  test('renders email and password fields in sign-in mode', async ({ page }) => {
    await page.goto('/login');

    // Target the card h2 — Shell also renders an h1 with the same text
    await expect(page.locator('h2', { hasText: /sign in/i })).toBeVisible();
    await expect(page.getByLabel('Email')).toBeVisible();
    await expect(page.getByLabel('Password', { exact: true })).toBeVisible();
    // Confirm password must NOT appear in sign-in mode
    await expect(page.getByLabel('Confirm password')).not.toBeVisible();
    // Use type=submit to distinguish from the nav-bar Sign In button
    await expect(page.locator('button[type="submit"]')).toBeVisible();
  });

  test('sign-up mode shows confirm password field', async ({ page }) => {
    await page.goto('/login');

    await page.getByRole('button', { name: /create one/i }).click();
    await expect(page.getByLabel('Confirm password')).toBeVisible();

    await expect(page.locator('h2', { hasText: /create account/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /^create account$/i })).toBeVisible();
  });

  test('sign-up: rejects passwords shorter than 8 characters', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: /create one/i }).click();
    await expect(page.getByLabel('Confirm password')).toBeVisible();

    await page.getByLabel('Email').fill('test@example.com');
    await page.getByLabel('Password', { exact: true }).fill('Ab1!');
    await page.getByLabel('Confirm password').fill('Ab1!');
    await page.getByRole('button', { name: /^create account$/i }).click();

    await expect(page.locator('.status-error')).toContainText(/password must be at least 8 characters\./i);
    // No network request should have been made — error appears immediately
  });

  test('sign-up: rejects passwords with no number or symbol', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: /create one/i }).click();
    await expect(page.getByLabel('Confirm password')).toBeVisible();

    await page.getByLabel('Email').fill('test@example.com');
    await page.getByLabel('Password', { exact: true }).fill('alllettersonly');
    await page.getByLabel('Confirm password').fill('alllettersonly');
    await page.getByRole('button', { name: /^create account$/i }).click();

    await expect(page.locator('.status-error')).toContainText(/password must include at least one number or symbol\./i);
  });

  test('sign-up: rejects mismatched confirm password', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: /create one/i }).click();
    await expect(page.getByLabel('Confirm password')).toBeVisible();

    await page.getByLabel('Email').fill('test@example.com');
    await page.getByLabel('Password', { exact: true }).fill('GoodPassword1!');
    await page.getByLabel('Confirm password').fill('DifferentPassword1!');
    await page.getByRole('button', { name: /^create account$/i }).click();

    await expect(page.getByText(/passwords do not match/i)).toBeVisible();
  });

  test('sign-in: password field is cleared after a failed attempt', async ({ page }) => {
    await page.goto('/login');

    const passwordInput = page.getByLabel('Password', { exact: true });

    await page.getByLabel('Email').fill('nonexistent@example.com');
    await passwordInput.fill('ValidPass1!');
    await page.locator('button[type="submit"]').click();

    // Wait for the error — auth will fail (supabaseUrl is empty in test env)
    await expect(page.locator('.status-error')).toBeVisible({ timeout: 10_000 });

    // Password field must be cleared
    await expect(passwordInput).toHaveValue('');
  });

  test('switching from sign-in to sign-up clears password fields', async ({ page }) => {
    await page.goto('/login');

    await page.getByLabel('Password', { exact: true }).fill('SomePassword1!');

    // Switch to sign-up
    await page.getByRole('button', { name: /create one/i }).click();
    await expect(page.getByLabel('Confirm password')).toBeVisible();

    await expect(page.getByLabel('Password', { exact: true })).toHaveValue('');
    await expect(page.getByLabel('Confirm password')).toHaveValue('');
  });

  test('switching from sign-up to sign-in clears password fields', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: /create one/i }).click();
    await expect(page.getByLabel('Confirm password')).toBeVisible();

    await page.getByLabel('Password', { exact: true }).fill('SomePassword1!');
    await page.getByLabel('Confirm password').fill('SomePassword1!');

    // Switch back to sign-in — use .link-button to avoid matching the nav bar button
    await page.locator('.link-button', { hasText: /sign in/i }).click();
    await expect(page.getByLabel('Confirm password')).not.toBeVisible();

    await expect(page.getByLabel('Password', { exact: true })).toHaveValue('');
  });

  test('sign-up: valid passwords that match proceed to auth (no client-side error)', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: /create one/i }).click();
    await expect(page.getByLabel('Confirm password')).toBeVisible();

    await page.getByLabel('Email').fill('test@example.com');
    await page.getByLabel('Password', { exact: true }).fill('StrongPass1!');
    await page.getByLabel('Confirm password').fill('StrongPass1!');
    await page.getByRole('button', { name: /^create account$/i }).click();

    // Client-side validation passes → no strength/match error shown
    await expect(page.getByText(/password must be at least 8 characters\./i)).not.toBeVisible();
    await expect(page.getByText(/passwords do not match/i)).not.toBeVisible();
    // Auth call fails in the mock (sign-up disabled) — confirms form proceeded past client-side validation
    await expect(page.locator('.status-error')).toBeVisible({ timeout: 10_000 });
  });
});
