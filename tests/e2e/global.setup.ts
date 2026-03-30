import type { FullConfig } from '@playwright/test';

const supabaseMockPort = Number(process.env.PLAYWRIGHT_SUPABASE_MOCK_PORT ?? 54321);
const organizerEmail = process.env.PLAYWRIGHT_ORGANIZER_EMAIL ?? 'organizer-smoke@origin-draft.test';
const organizerPassword = process.env.PLAYWRIGHT_ORGANIZER_PASSWORD ?? 'OrganizerSmoke123!';
const judgeEmail = process.env.PLAYWRIGHT_JUDGE_EMAIL ?? 'judge-smoke@origin-draft.test';
const judgePassword = process.env.PLAYWRIGHT_JUDGE_PASSWORD ?? 'JudgeSmoke123!';
const unassignedJudgeEmail = process.env.PLAYWRIGHT_UNASSIGNED_JUDGE_EMAIL ?? 'judge-unassigned-smoke@origin-draft.test';
const unassignedJudgePassword = process.env.PLAYWRIGHT_UNASSIGNED_JUDGE_PASSWORD ?? 'JudgeUnassigned123!';
const entrantEmail = process.env.PLAYWRIGHT_ENTRANT_EMAIL ?? 'entrant-smoke@origin-draft.test';
const entrantPassword = process.env.PLAYWRIGHT_ENTRANT_PASSWORD ?? 'EntrantSmoke123!';

async function waitFor(url: string, attempts = 60, delayMs = 2000) {
  for (let index = 0; index < attempts; index += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // keep waiting
    }

    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  throw new Error(`Timed out waiting for ${url}`);
}

export default async function globalSetup(_config: FullConfig) {
  await waitFor(`http://127.0.0.1:${supabaseMockPort}/health`);

  process.env.PLAYWRIGHT_ORGANIZER_EMAIL = organizerEmail;
  process.env.PLAYWRIGHT_ORGANIZER_PASSWORD = organizerPassword;
  process.env.PLAYWRIGHT_JUDGE_EMAIL = judgeEmail;
  process.env.PLAYWRIGHT_JUDGE_PASSWORD = judgePassword;
  process.env.PLAYWRIGHT_UNASSIGNED_JUDGE_EMAIL = unassignedJudgeEmail;
  process.env.PLAYWRIGHT_UNASSIGNED_JUDGE_PASSWORD = unassignedJudgePassword;
  process.env.PLAYWRIGHT_ENTRANT_EMAIL = entrantEmail;
  process.env.PLAYWRIGHT_ENTRANT_PASSWORD = entrantPassword;
}
