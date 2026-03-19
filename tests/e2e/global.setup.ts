import { execFileSync } from 'node:child_process';
import type { FullConfig } from '@playwright/test';

const repoRoot = process.cwd();
const keycloakBaseUrl = process.env.PLAYWRIGHT_KEYCLOAK_BASE_URL ?? 'http://127.0.0.1:8080';
const realm = process.env.KEYCLOAK_REALM ?? 'contest-platform';
const adminUser = process.env.KEYCLOAK_ADMIN ?? 'admin';
const adminPassword = process.env.KEYCLOAK_ADMIN_PASSWORD ?? 'change-me';
const clientId = process.env.KEYCLOAK_CLIENT_ID ?? 'contest-platform-web';
const webPort = Number(process.env.PLAYWRIGHT_WEB_PORT ?? 4174);
const smokeUsername = process.env.PLAYWRIGHT_SMOKE_USERNAME ?? 'organizer-smoke';
const smokePassword = process.env.PLAYWRIGHT_SMOKE_PASSWORD ?? 'OrganizerSmoke123!';
const smokeEmail = process.env.PLAYWRIGHT_SMOKE_EMAIL ?? 'organizer-smoke@origin-draft.test';
const judgeUsername = process.env.PLAYWRIGHT_JUDGE_USERNAME ?? 'judge-smoke';
const judgePassword = process.env.PLAYWRIGHT_JUDGE_PASSWORD ?? 'JudgeSmoke123!';
const judgeEmail = process.env.PLAYWRIGHT_JUDGE_EMAIL ?? 'judge-smoke@origin-draft.test';
const unassignedJudgeUsername = process.env.PLAYWRIGHT_UNASSIGNED_JUDGE_USERNAME ?? 'judge-unassigned-smoke';
const unassignedJudgePassword = process.env.PLAYWRIGHT_UNASSIGNED_JUDGE_PASSWORD ?? 'JudgeUnassigned123!';
const unassignedJudgeEmail = process.env.PLAYWRIGHT_UNASSIGNED_JUDGE_EMAIL ?? 'judge-unassigned-smoke@origin-draft.test';
const entrantUsername = process.env.PLAYWRIGHT_ENTRANT_USERNAME ?? 'entrant-smoke';
const entrantPassword = process.env.PLAYWRIGHT_ENTRANT_PASSWORD ?? 'EntrantSmoke123!';
const entrantEmail = process.env.PLAYWRIGHT_ENTRANT_EMAIL ?? 'entrant-smoke@origin-draft.test';

type SmokeUser = {
  username: string;
  password: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
};

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

function execKeycloak(args: string[]): string {
  return execFileSync(
    'docker',
    ['compose', '-f', 'infra/docker-compose.yml', 'exec', '-T', 'keycloak', ...args],
    {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
}

function execKcadm(args: string[]): string {
  return execKeycloak(['/opt/keycloak/bin/kcadm.sh', ...args]);
}

function configureKcadm() {
  execKcadm([
    'config',
    'credentials',
    '--server',
    'http://127.0.0.1:8080',
    '--realm',
    'master',
    '--user',
    adminUser,
    '--password',
    adminPassword,
  ]);
}

function ensureClientRedirects() {
  const rawClients = execKcadm(['get', 'clients', '-r', realm, '-q', `clientId=${clientId}`]);
  const clients = JSON.parse(rawClients) as Array<{ id: string }>;
  const client = clients[0];
  if (!client) {
    throw new Error(`Keycloak client ${clientId} was not found in realm ${realm}`);
  }

  const redirectUris = JSON.stringify([
    `http://127.0.0.1:${webPort}/*`,
    `http://localhost:${webPort}/*`,
    'http://localhost:5173/*',
    'http://localhost:4173/*',
  ]);
  const webOrigins = JSON.stringify([
    `http://127.0.0.1:${webPort}`,
    `http://localhost:${webPort}`,
    'http://localhost:5173',
    'http://localhost:4173',
  ]);

  execKcadm([
    'update',
    `clients/${client.id}`,
    '-r',
    realm,
    '-s',
    `redirectUris=${redirectUris}`,
    '-s',
    `webOrigins=${webOrigins}`,
    '-s',
    'publicClient=true',
    '-s',
    'standardFlowEnabled=true',
    '-s',
    'directAccessGrantsEnabled=false',
    '-s',
    'protocol=openid-connect',
  ]);
}

function ensureSmokeUser(user: SmokeUser) {
  const rawUsers = execKcadm(['get', 'users', '-r', realm, '-q', `username=${user.username}`]);
  const users = JSON.parse(rawUsers) as Array<{ id: string }>;

  if (!users[0]?.id) {
    execKcadm([
      'create',
      'users',
      '-r',
      realm,
      '-s',
      `username=${user.username}`,
      '-s',
      `email=${user.email}`,
      '-s',
      'enabled=true',
      '-s',
      'emailVerified=true',
      '-s',
      `firstName=${user.firstName}`,
      '-s',
      `lastName=${user.lastName}`,
    ]);
  }

  execKcadm(['set-password', '-r', realm, '--username', user.username, '--new-password', user.password]);
  execKcadm(['add-roles', '-r', realm, '--uusername', user.username, '--rolename', user.role]);
}

export default async function globalSetup(_config: FullConfig) {
  execFileSync('docker', ['compose', '-f', 'infra/docker-compose.yml', 'up', '-d', 'postgres', 'keycloak-postgres', 'keycloak'], {
    cwd: repoRoot,
    stdio: 'inherit',
  });

  await waitFor(`${keycloakBaseUrl}/realms/${realm}`);

  configureKcadm();
  ensureClientRedirects();
  ensureSmokeUser({
    username: smokeUsername,
    password: smokePassword,
    email: smokeEmail,
    firstName: 'Organizer',
    lastName: 'Smoke',
    role: 'organizer',
  });
  ensureSmokeUser({
    username: judgeUsername,
    password: judgePassword,
    email: judgeEmail,
    firstName: 'Judge',
    lastName: 'Smoke',
    role: 'judge',
  });
  ensureSmokeUser({
    username: unassignedJudgeUsername,
    password: unassignedJudgePassword,
    email: unassignedJudgeEmail,
    firstName: 'Judge',
    lastName: 'Unassigned',
    role: 'judge',
  });
  ensureSmokeUser({
    username: entrantUsername,
    password: entrantPassword,
    email: entrantEmail,
    firstName: 'Entrant',
    lastName: 'Smoke',
    role: 'entrant',
  });

  process.env.PLAYWRIGHT_SMOKE_USERNAME = smokeUsername;
  process.env.PLAYWRIGHT_SMOKE_PASSWORD = smokePassword;
  process.env.PLAYWRIGHT_JUDGE_USERNAME = judgeUsername;
  process.env.PLAYWRIGHT_JUDGE_PASSWORD = judgePassword;
  process.env.PLAYWRIGHT_UNASSIGNED_JUDGE_USERNAME = unassignedJudgeUsername;
  process.env.PLAYWRIGHT_UNASSIGNED_JUDGE_PASSWORD = unassignedJudgePassword;
  process.env.PLAYWRIGHT_ENTRANT_USERNAME = entrantUsername;
  process.env.PLAYWRIGHT_ENTRANT_PASSWORD = entrantPassword;
}
