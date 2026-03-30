import { createHmac, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';

const port = Number(process.env.SUPABASE_MOCK_PORT ?? 54321);
const jwtSecret = process.env.SUPABASE_MOCK_JWT_SECRET ?? 'contest-platform-e2e-supabase-jwt-secret';
const issuer = process.env.SUPABASE_MOCK_ISSUER ?? `http://127.0.0.1:${port}/auth/v1`;

const users = [
  {
    email: process.env.PLAYWRIGHT_ORGANIZER_EMAIL ?? 'organizer-smoke@origin-draft.test',
    password: process.env.PLAYWRIGHT_ORGANIZER_PASSWORD ?? 'OrganizerSmoke123!',
    id: 'organizer-smoke-id',
    fullName: 'Organizer Smoke',
    roles: ['organizer'],
  },
  {
    email: process.env.PLAYWRIGHT_JUDGE_EMAIL ?? 'judge-smoke@origin-draft.test',
    password: process.env.PLAYWRIGHT_JUDGE_PASSWORD ?? 'JudgeSmoke123!',
    id: 'judge-smoke-id',
    fullName: 'Judge Smoke',
    roles: ['judge'],
  },
  {
    email: process.env.PLAYWRIGHT_UNASSIGNED_JUDGE_EMAIL ?? 'judge-unassigned-smoke@origin-draft.test',
    password: process.env.PLAYWRIGHT_UNASSIGNED_JUDGE_PASSWORD ?? 'JudgeUnassigned123!',
    id: 'judge-unassigned-smoke-id',
    fullName: 'Judge Unassigned',
    roles: ['judge'],
  },
  {
    email: process.env.PLAYWRIGHT_ENTRANT_EMAIL ?? 'entrant-smoke@origin-draft.test',
    password: process.env.PLAYWRIGHT_ENTRANT_PASSWORD ?? 'EntrantSmoke123!',
    id: 'entrant-smoke-id',
    fullName: 'Entrant Smoke',
    roles: ['entrant'],
  },
];

const userByEmail = new Map(users.map((user) => [user.email.toLowerCase(), user]));

function base64url(value) {
  return Buffer.from(value)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function signJwt(payload) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const encodedHeader = base64url(JSON.stringify(header));
  const encodedPayload = base64url(JSON.stringify(payload));
  const data = `${encodedHeader}.${encodedPayload}`;
  const signature = createHmac('sha256', jwtSecret)
    .update(data)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  return `${data}.${signature}`;
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  };
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    ...corsHeaders(),
    'Content-Type': 'application/json',
  });
  response.end(JSON.stringify(payload));
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) return {};

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return {};
  }
}

const server = createServer(async (request, response) => {
  if (!request.url) {
    sendJson(response, 400, { msg: 'Missing URL' });
    return;
  }

  const url = new URL(request.url, `http://${request.headers.host ?? `127.0.0.1:${port}`}`);

  if (request.method === 'OPTIONS') {
    response.writeHead(204, corsHeaders());
    response.end();
    return;
  }

  if (request.method === 'GET' && url.pathname === '/health') {
    sendJson(response, 200, { status: 'ok' });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'password') {
    const body = await readJsonBody(request);
    const email = typeof body.email === 'string' ? body.email.toLowerCase().trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const user = userByEmail.get(email);

    if (!user || user.password !== password) {
      sendJson(response, 400, { error_description: 'Invalid login credentials' });
      return;
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    const accessToken = signJwt({
      aud: 'authenticated',
      role: 'authenticated',
      iss: issuer,
      sub: user.id,
      email: user.email,
      phone: '',
      app_metadata: {
        provider: 'email',
        roles: user.roles,
      },
      user_metadata: {
        full_name: user.fullName,
      },
      iat: nowSeconds,
      exp: nowSeconds + 60 * 60,
    });

    sendJson(response, 200, {
      access_token: accessToken,
      token_type: 'bearer',
      expires_in: 3600,
      refresh_token: `refresh-${randomUUID()}`,
    });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/auth/v1/logout') {
    sendJson(response, 200, {});
    return;
  }

  if (request.method === 'POST' && url.pathname === '/auth/v1/signup') {
    sendJson(response, 400, {
      msg: 'Sign-up is disabled in the e2e auth mock service.',
    });
    return;
  }

  sendJson(response, 404, { msg: 'Not found' });
});

server.listen(port, '127.0.0.1', () => {
  // eslint-disable-next-line no-console
  console.log(`[supabase-mock] listening on http://127.0.0.1:${port}`);
});

function shutdown(signal) {
  server.close(() => {
    // eslint-disable-next-line no-console
    console.log(`[supabase-mock] shutdown via ${signal}`);
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
