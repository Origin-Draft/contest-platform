import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const username = process.env.PLAYWRIGHT_SMOKE_USERNAME ?? 'organizer-smoke';
const password = process.env.PLAYWRIGHT_SMOKE_PASSWORD ?? 'OrganizerSmoke123!';
const judgeUsername = process.env.PLAYWRIGHT_JUDGE_USERNAME ?? 'judge-smoke';
const judgePassword = process.env.PLAYWRIGHT_JUDGE_PASSWORD ?? 'JudgeSmoke123!';
const unassignedJudgeUsername = process.env.PLAYWRIGHT_UNASSIGNED_JUDGE_USERNAME ?? 'judge-unassigned-smoke';
const unassignedJudgePassword = process.env.PLAYWRIGHT_UNASSIGNED_JUDGE_PASSWORD ?? 'JudgeUnassigned123!';
const entrantUsername = process.env.PLAYWRIGHT_ENTRANT_USERNAME ?? 'entrant-smoke';
const entrantPassword = process.env.PLAYWRIGHT_ENTRANT_PASSWORD ?? 'EntrantSmoke123!';
const seededEntryPath = '/submissions/entry-001';
const seededEntryTitle = 'The Last Warm Compiler';
const seededContestTitle = 'Neon Ink Spring 2026';
const seededAuthors = 'Ari Vale, Sam Osei, Jun Park';
const hiddenForJudgesText = 'Hidden for judges by contest policy.';

async function loginWithKeycloak(page: Page, credentials?: { username: string; password: string; returnPath?: string }) {
  const nextUsername = credentials?.username ?? username;
  const nextPassword = credentials?.password ?? password;
  const returnPath = credentials?.returnPath ?? '/';

  await page.goto(returnPath);

  await expect(page.getByRole('button', { name: /sign in with keycloak/i })).toBeVisible();
  await page.getByRole('button', { name: /sign in with keycloak/i }).click();

  await expect(page).toHaveURL(/localhost:8080|127\.0\.0\.1:8080/);

  const usernameInput = page.locator('input[name="username"], input[name="email"], input[autocomplete="username"]').first();
  await expect(usernameInput).toBeVisible();
  await usernameInput.fill(nextUsername);

  const passwordInput = page.locator('input[name="password"], input[type="password"]').first();
  await passwordInput.fill(nextPassword);

  const submitButton = page.getByRole('button', { name: /sign in|log in/i }).first();
  await submitButton.click();

  await expect(page).toHaveURL(/localhost:4174|127\.0\.0\.1:4174/, { timeout: 15000 });
  await expect(page.getByRole('button', { name: /sign out/i })).toBeVisible({ timeout: 15000 });
}

test('organizer route requires authentication before login', async ({ page }) => {
  await page.goto('/organizer');

  await expect(page.getByRole('heading', { name: /authentication required/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /sign in with keycloak/i })).toBeVisible();
});

test('organizer can sign in via Keycloak and open organizer tools', async ({ page }) => {
  await loginWithKeycloak(page);

  await page.goto('/organizer');
  await expect(page.getByRole('heading', { name: /control center/i })).toBeVisible();
});

test('organizer can sign out and loses organizer access', async ({ page }) => {
  await loginWithKeycloak(page);

  await page.getByRole('button', { name: /sign out/i }).click();

  await expect(page).toHaveURL(/localhost:4174|127\.0\.0\.1:4174/, { timeout: 15000 });
  await expect(page.getByRole('button', { name: /sign in with keycloak/i })).toBeVisible({ timeout: 15000 });
  await expect(page.getByText(/no active session yet/i)).toBeVisible();

  await page.goto('/organizer');
  await expect(page.getByRole('heading', { name: /authentication required/i })).toBeVisible();
});

test('judge can access judge tools but not organizer admin', async ({ page }) => {
  await loginWithKeycloak(page, {
    username: judgeUsername,
    password: judgePassword,
    returnPath: '/judge',
  });

  await expect(page.getByRole('heading', { name: /judge portal/i })).toBeVisible();
  await expect(page.getByRole('heading', { name: /submit scorecard/i })).toBeVisible();

  await page.goto('/organizer');
  await expect(page.getByRole('heading', { name: /access restricted/i })).toBeVisible();
  await expect(page.getByText(/requires one of these roles: organizer, platform-admin/i)).toBeVisible();
});

test('entrant can access entrant portal but not judge or organizer routes', async ({ page }) => {
  await loginWithKeycloak(page, {
    username: entrantUsername,
    password: entrantPassword,
    returnPath: '/entrant',
  });

  await expect(page.getByRole('heading', { name: /entrant portal/i })).toBeVisible();
  await expect(page.getByRole('heading', { name: /create a submission/i })).toBeVisible();

  await page.goto('/judge');
  await expect(page.getByRole('heading', { name: /access restricted/i })).toBeVisible();
  await expect(page.getByText(/requires one of these roles: judge, organizer, platform-admin/i)).toBeVisible();

  await page.goto('/organizer');
  await expect(page.getByRole('heading', { name: /access restricted/i })).toBeVisible();
  await expect(page.getByText(/requires one of these roles: organizer, platform-admin/i)).toBeVisible();
});

test('organizer can create a draft contest and open its preview', async ({ page }) => {
  await loginWithKeycloak(page, {
    username,
    password,
    returnPath: '/organizer',
  });

  const uniqueSuffix = Date.now();
  const title = `Playwright Draft Preview ${uniqueSuffix}`;
  const slug = `playwright-draft-preview-${uniqueSuffix}`;

  await page.getByRole('textbox', { name: /^title$/i }).fill(title);
  await page.getByRole('textbox', { name: /^slug$/i }).fill(slug);
  await page.getByRole('button', { name: /create contest/i }).click();

  await expect(page.getByText(new RegExp(`Created ${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i'))).toBeVisible();

  const contestRow = page.locator('article.contest-list-row').filter({ has: page.getByRole('heading', { name: title }) }).first();
  await expect(contestRow).toBeVisible();
  await contestRow.getByRole('link', { name: /preview/i }).click();

  await expect(page).toHaveURL(/\/organizer\/contests\/.*\/preview/);
  await expect(page.getByRole('heading', { name: new RegExp(`${title} preview`, 'i') })).toBeVisible();
  await expect(page.getByText(/draft preview only/i)).toBeVisible();
});

test('judge cannot access organizer contest preview route', async ({ page }) => {
  await loginWithKeycloak(page, {
    username: judgeUsername,
    password: judgePassword,
    returnPath: '/judge',
  });

  await page.goto('/organizer/contests/contest-neon-ink/preview');
  await expect(page.getByRole('heading', { name: /access restricted/i })).toBeVisible();
  await expect(page.getByText(/requires one of these roles: organizer, platform-admin/i)).toBeVisible();
});

test('judge cannot open a submission that is not assigned to them', async ({ page }) => {
  await loginWithKeycloak(page, {
    username: unassignedJudgeUsername,
    password: unassignedJudgePassword,
    returnPath: seededEntryPath,
  });

  await expect(page.getByText(/unable to load submission: judges may only access submissions assigned to them\./i)).toBeVisible();
});

test('organizer sees full submission detail with provenance and artifacts tools', async ({ page }) => {
  await loginWithKeycloak(page, {
    username,
    password,
    returnPath: seededEntryPath,
  });

  await expect(page.getByRole('heading', { name: seededEntryTitle })).toBeVisible();
  await expect(page.getByText(new RegExp(`${seededContestTitle} \\u00b7 ${seededAuthors.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i'))).toBeVisible();
  await expect(page.getByText(/contest-specific disclosure pending final submission\./i)).toBeVisible();

  await expect(page.getByRole('heading', { name: /scene cards/i })).toBeVisible();
  await expect(page.getByText(/ari reviews unstable compiler output/i)).toBeVisible();
  await expect(page.getByRole('heading', { name: /steps to reproduce/i })).toBeVisible();
  await expect(page.getByText(/use ai to generate structural alternatives/i)).toBeVisible();
  await expect(page.getByRole('heading', { name: /prompt history/i })).toBeVisible();
  await expect(page.getByText(/prompt batch focused on alternate scene sequencing/i)).toBeVisible();
  await expect(page.getByRole('heading', { name: /consent profile/i })).toBeVisible();
  await expect(page.getByText(/research use: allowed/i)).toBeVisible();
  await expect(page.getByText(/training use: not allowed/i)).toBeVisible();

  await expect(page.getByText(/allowed artifact types for this contest:/i)).toBeVisible();
  await expect(page.getByRole('button', { name: /upload artifact/i })).toBeVisible();
  await expect(page.getByText(/no artifacts yet/i)).toBeVisible();
  await expect(page.getByText(hiddenForJudgesText)).not.toBeVisible();
});

test('organizer can assign a judge and that judge sees blinded submission detail', async ({ page }) => {
  await loginWithKeycloak(page, {
    username,
    password,
    returnPath: '/organizer',
  });

  await page.getByRole('textbox', { name: /judge name/i }).fill('Judge Smoke');
  await page.getByRole('button', { name: /create assignment/i }).click();

  await expect(page.getByText(/assigned the last warm compiler to judge smoke\./i)).toBeVisible();

  await page.getByRole('button', { name: /sign out/i }).click();
  await expect(page.getByRole('button', { name: /sign in with keycloak/i })).toBeVisible();

  await loginWithKeycloak(page, {
    username: judgeUsername,
    password: judgePassword,
    returnPath: '/judge',
  });

  const assignedSubmission = page.locator('article.contest-list-row').filter({
    has: page.getByRole('heading', { name: seededEntryTitle }),
    hasText: 'Judge Smoke',
  }).first();
  await expect(assignedSubmission).toBeVisible();
  await Promise.all([
    page.waitForURL(/\/submissions\/entry-001/),
    assignedSubmission.getByRole('link', { name: /open manuscript/i }).click(),
  ]);

  await expect(page.locator('section.manuscript-card').getByRole('heading', { name: seededEntryTitle })).toBeVisible();
  await expect(page.getByText(new RegExp(`${seededContestTitle} \\u00b7 Anonymous entrant`, 'i'))).toBeVisible();
  await expect(page.getByText(seededAuthors)).not.toBeVisible();
  await expect(page.getByText(/contest-specific disclosure pending final submission\./i)).toBeVisible();
  await expect(page.getByRole('heading', { name: /process provenance/i })).toBeVisible();
  await expect(page.getByText(hiddenForJudgesText)).toHaveCount(2);
  await expect(page.getByRole('heading', { name: /scene cards/i })).not.toBeVisible();
  await expect(page.getByRole('heading', { name: /prompt history/i })).not.toBeVisible();
  await expect(page.getByRole('button', { name: /upload artifact/i })).not.toBeVisible();
});

test('entrant cannot open another entrant submission detail', async ({ page }) => {
  await loginWithKeycloak(page, {
    username: entrantUsername,
    password: entrantPassword,
    returnPath: seededEntryPath,
  });

  await expect(page.getByText(/unable to load submission: entrants may only access their own submissions\./i)).toBeVisible();
});
