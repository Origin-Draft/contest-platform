# Deployment Guide: Fly.io + Supabase + Cloudflare Pages

This guide covers deploying Origin Draft to the production cloud stack. It uses only free tiers.

| Layer | Service | Current production |
|-------|---------|-------------------|
| API | [Fly.io](https://fly.io) | `contest-platform-api` → `api.origindraft.org` |
| Frontend | [Cloudflare Pages](https://pages.cloudflare.com) | `contest-platform-web` → `origindraft.org` |
| Auth + Database | [Supabase](https://supabase.com) | Your Supabase project |
| File storage | [Supabase Storage](https://supabase.com/docs/guides/storage) | `artifacts` bucket |
| DNS + CDN | [Cloudflare](https://cloudflare.com) | Zone `origindraft.org` |

Pushes to `main` deploy automatically via the CI pipeline (4 jobs: build-and-test, docker-build, deploy-api, deploy-web).

---

## Architecture overview

```
Browser → origindraft.org (Cloudflare Pages)
  └── JS calls → api.origindraft.org (Fly.io, Node 22 Alpine)
        ├── Database: Supabase Postgres (direct connection, superuser)
        ├── Auth: Supabase Auth (email/password, PKCE flow)
        │     └── custom JWT hook injects roles from user_roles table
        └── Storage: Supabase Storage (service-role key, artifacts bucket)
```

**Auth flow:** The frontend fetches auth config from `GET /api/session/config`, which returns the Supabase URL and anon key. Login is email/password via Supabase's `/auth/v1/token?grant_type=password` endpoint (no OAuth redirect). JWTs are verified server-side with the symmetric `SUPABASE_JWT_SECRET` using `jose.jwtVerify()`.

---

## Prerequisites

- [Fly.io account](https://fly.io) with billing enabled (free tier requires a credit card)
- [Supabase account](https://supabase.com) — free tier project
- [Cloudflare account](https://cloudflare.com) — free plan
- GitHub repository with Actions enabled
- `flyctl`, `pnpm`, and `wrangler` CLIs installed locally

---

## Step 1: Supabase project setup

### 1a. Run the roles SQL

In your Supabase dashboard → **SQL Editor**, paste and run:

```
infra/supabase/setup-roles.sql
```

This creates:
- `public.user_roles` table with RLS enabled
- `public.custom_access_token_hook` function that injects roles into JWTs

### 1b. Run the storage SQL

In the same SQL Editor, paste and run:

```
infra/supabase/setup-storage.sql
```

This creates the `artifacts` bucket (private, 50 MB limit) with service-role-only policies.

### 1c. Enable RLS on application tables

The API's bootstrap SQL creates application tables (`contests`, `entries`, `teams`, etc.) in the `public` schema. These are exposed to Supabase's PostgREST API via the public `anon` key. Enable RLS on all of them to block anonymous REST access:

```sql
ALTER TABLE public.contests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.judge_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.submission_provenance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.submission_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.submission_artifacts ENABLE ROW LEVEL SECURITY;
```

No ALLOW policies are needed — the API connects as the `postgres` superuser, which bypasses RLS. This simply prevents the public `anon` key from querying these tables through PostgREST.

> **Note:** Run this after the first API deploy, since the tables are created by the API on startup.

### 1d. Register the custom JWT hook

1. Go to **Authentication → Hooks** in your Supabase dashboard
2. Under **Custom Access Token**, enable the hook
3. Set the function to `public.custom_access_token_hook`
4. Save

> **Why this matters**: Without this hook, all JWTs will have an empty `app_metadata.roles` array, causing every authenticated user to get 403 errors on role-protected endpoints.

### 1e. Configure auth URLs

Go to **Authentication → URL Configuration**:

| Setting | Value |
|---------|-------|
| **Site URL** | `https://origindraft.org` (your frontend domain, no wildcard) |
| **Redirect URLs** | `https://origindraft.org/**` |

This ensures email confirmation links point to your domain.

### 1f. Collect your Supabase credentials

From **Project Settings → API**:

| Variable | Where to find it |
|----------|-----------------|
| `SUPABASE_URL` | Project URL (e.g. `https://abcdef.supabase.co`) |
| `SUPABASE_ANON_KEY` | `anon` `public` key |
| `SUPABASE_SERVICE_ROLE_KEY` | `service_role` key (keep secret!) |
| `SUPABASE_JWT_SECRET` | **Project Settings → API → JWT Settings → JWT Secret** |

From **Project Settings → Database → Connection string → URI**:

```
postgresql://postgres:[password]@db.[ref].supabase.co:5432/postgres
```

> **Important: URL-encode special characters in the password.** If the Supabase-generated password contains `/`, `*`, `@`, `#`, `?`, or other URL-special characters, you must percent-encode them (e.g. `/` → `%2F`, `*` → `%2A`). The API passes this string directly to `pg.Pool({ connectionString })`, which parses it as a URL. An unencoded `/` or `*` in the password will cause `ERR_INVALID_URL` and the app will not start.

---

## Step 2: Fly.io setup

### 2a. Authenticate and create the app

```bash
flyctl auth login
flyctl apps create contest-platform-api
```

### 2b. Set secrets

```bash
flyctl secrets set -a contest-platform-api \
  DATABASE_URL="postgresql://postgres:YOUR_ENCODED_PASSWORD@db.YOURREF.supabase.co:5432/postgres" \
  SUPABASE_URL="https://YOURREF.supabase.co" \
  SUPABASE_ANON_KEY="your-anon-key" \
  SUPABASE_SERVICE_ROLE_KEY="your-service-role-key" \
  SUPABASE_JWT_SECRET="your-jwt-secret" \
  WEB_ORIGIN="https://origindraft.org" \
  CORS_ALLOWED_ORIGINS="https://origindraft.org,https://contest-platform-web.pages.dev"
```

The static env vars (`PLATFORM_MODE`, `AUTH_PROVIDER`, `STORAGE_PROVIDER`, `DATABASE_SSL`, `API_HOST`, `API_PORT`, `LOG_LEVEL`, `UPLOAD_DIR`) are set in `fly.toml` — do not duplicate them as secrets.

### 2c. Deploy manually for the first time

```bash
flyctl deploy
```

Verify:

```bash
flyctl status -a contest-platform-api
curl https://contest-platform-api.fly.dev/api/health
# → {"status":"ok","service":"contest-platform-api","timestamp":"..."}
```

If the health check fails, check `flyctl logs -a contest-platform-api` — the most common cause is an invalid `DATABASE_URL` (unencoded password characters).

### 2d. Custom domain (optional)

```bash
flyctl certs add api.origindraft.org -a contest-platform-api
```

Then add DNS records in your DNS provider (Cloudflare, etc.):

| Type | Name | Value | Proxy |
|------|------|-------|-------|
| A | `api` | `<fly-ipv4>` (from `flyctl ips list`) | DNS only |
| AAAA | `api` | `<fly-ipv6>` (from `flyctl ips list`) | DNS only |

> **Important:** Use **DNS only** (grey cloud in Cloudflare), not Proxied. Fly.io manages its own TLS via Let's Encrypt. Proxying would double-terminate TLS and break certificate validation.

After adding DNS records, verify the cert:

```bash
flyctl certs show api.origindraft.org -a contest-platform-api
# Status should be "Issued"
```

Then update the Fly.io secrets:

```bash
flyctl secrets set -a contest-platform-api \
  WEB_ORIGIN="https://origindraft.org" \
  CORS_ALLOWED_ORIGINS="https://origindraft.org,https://contest-platform-web.pages.dev"
```

---

## Step 3: Cloudflare Pages setup

### 3a. Build and deploy manually

```bash
pnpm --filter @origin-draft/shared build
VITE_PLATFORM_MODE=production \
  VITE_API_BASE_URL=https://api.origindraft.org/api \
  pnpm --filter @origin-draft/web build

npx wrangler pages deploy apps/web/dist \
  --project-name=contest-platform-web \
  --branch=prod \
  --commit-dirty=true
```

The `--branch=prod` flag is required to deploy to the production URL. Without it, CF Pages treats the deploy as a preview.

### 3b. Custom domain (optional)

In the Cloudflare dashboard → **Pages → contest-platform-web → Custom domains**, add `origindraft.org`. Then add the DNS record:

| Type | Name | Value | Proxy |
|------|------|-------|-------|
| CNAME | `@` | `contest-platform-web.pages.dev` | Proxied |

> **Note:** Unlike the API, the frontend **should** be proxied through Cloudflare (orange cloud) — Cloudflare Pages expects this.

---

## Step 4: GitHub Actions — CI/CD secrets and variables

Go to **GitHub → repo Settings → Secrets and variables → Actions**:

### Secrets (encrypted)

| Secret | How to create | Notes |
|--------|--------------|-------|
| `FLY_API_TOKEN` | `flyctl tokens create deploy -a contest-platform-api` | Scoped deploy token (preferred over personal tokens) |
| `CLOUDFLARE_API_TOKEN` | Cloudflare dashboard → **My Profile → API Tokens → Create Token** → "Edit Cloudflare Workers" template | Needs Workers Scripts Edit + Pages Edit permissions |

### Variables (plain text)

| Variable | Value |
|----------|-------|
| `CLOUDFLARE_ACCOUNT_ID` | From Cloudflare dashboard sidebar |
| `VITE_API_BASE_URL` | `https://api.origindraft.org/api` (or `https://contest-platform-api.fly.dev/api` if no custom domain) |

---

## Step 5: Verify the CI pipeline

Push a commit to `main` and confirm all 4 jobs pass:

1. **`build-and-test`** — pnpm install, build all packages, typecheck, API unit tests
2. **`docker-build`** — builds API and web Docker images (smoke test, no push)
3. **`deploy-api`** — `flyctl deploy --remote-only` to Fly.io
4. **`deploy-web`** — builds frontend with `VITE_API_BASE_URL` and deploys to Cloudflare Pages

---

## Step 6: Create the first admin user

1. Go to `https://origindraft.org/login` and create an account
2. Check your email for the confirmation link (Supabase sends this automatically)
3. After confirming, find your user ID in Supabase → **Authentication → Users**
4. In the SQL Editor, grant the admin role:

```sql
INSERT INTO public.user_roles (user_id, role)
VALUES ('<your-user-uuid>', 'platform-admin');
```

5. Sign out and sign back in so the JWT hook issues a new token with the role

---

## Configuration reference

### Fly.io secrets (set via `flyctl secrets set`)

| Secret | Description |
|--------|-------------|
| `DATABASE_URL` | Supabase Postgres connection string (URL-encode special password chars!) |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_ANON_KEY` | Supabase `anon` public key (sent to browsers for auth) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (server-side only, for storage) |
| `SUPABASE_JWT_SECRET` | Symmetric HS256 key for JWT verification |
| `WEB_ORIGIN` | Frontend origin, e.g. `https://origindraft.org` |
| `CORS_ALLOWED_ORIGINS` | Comma-separated allowed CORS origins |

### fly.toml static env vars (committed in repo)

| Variable | Value | Notes |
|----------|-------|-------|
| `PLATFORM_MODE` | `production` | Prevents seed data, enables strict validation |
| `AUTH_PROVIDER` | `supabase` | Uses Supabase Auth (alternative: `keycloak`) |
| `STORAGE_PROVIDER` | `supabase` | Uses Supabase Storage (alternative: `local`) |
| `DATABASE_SSL` | `true` | Required for Supabase connections |
| `API_HOST` | `0.0.0.0` | Bind to all interfaces inside the Fly VM |
| `API_PORT` | `4000` | Must match `http_service.internal_port` |
| `LOG_LEVEL` | `info` | |
| `UPLOAD_DIR` | `/app/uploads` | Ephemeral on Fly.io (files go to Supabase Storage) |

### GitHub Actions variables

| Name | Type | Description |
|------|------|-------------|
| `FLY_API_TOKEN` | Secret | Fly.io deploy token |
| `CLOUDFLARE_API_TOKEN` | Secret | Cloudflare API token with Workers/Pages edit |
| `CLOUDFLARE_ACCOUNT_ID` | Variable | Cloudflare account ID |
| `VITE_API_BASE_URL` | Variable | Full API base URL baked into frontend build |

### Frontend build-time env vars

| Variable | Description |
|----------|-------------|
| `VITE_PLATFORM_MODE` | `production` — set in CI |
| `VITE_API_BASE_URL` | API base URL — set in CI from GitHub variable |

The frontend does **not** use `VITE_SUPABASE_URL` or similar — all Supabase credentials are fetched at runtime from `GET /api/session/config`.

---

## Security checklist

- [ ] Supabase service role key is **only** in Fly.io secrets, never committed to the repo
- [ ] `AUTH_DEV_BYPASS` is NOT set (defaults to `false` in production)
- [ ] `PLATFORM_MODE = "production"` is set in `fly.toml`
- [ ] JWT hook is registered (without it, all users get empty roles → 403 on everything)
- [ ] `CORS_ALLOWED_ORIGINS` matches your frontend domain(s) exactly
- [ ] RLS is enabled on all `public` schema tables (prevents PostgREST bypass via anon key)
- [ ] Supabase Site URL and Redirect URLs are set to your frontend domain
- [ ] `DATABASE_URL` password has special characters URL-encoded
- [ ] Fly.io API DNS records are set to **DNS only** (not proxied through Cloudflare)

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| API won't start, `ERR_INVALID_URL` in logs | `DATABASE_URL` password has unencoded `/`, `*`, etc. | URL-encode special chars: `/` → `%2F`, `*` → `%2A`, `@` → `%40` |
| Every request returns 401 | JWT hook not registered | Complete Step 1d |
| User is authenticated but gets 403 | No row in `user_roles` | Insert a role — see Step 6 |
| Login form shows "Invalid login credentials" | User hasn't confirmed email, or wrong password | Check Supabase → Authentication → Users for confirmation status |
| File uploads fail | `setup-storage.sql` not run | Complete Step 1b |
| API health check times out | Machine crashed on boot — usually a bad secret | Run `flyctl logs -a contest-platform-api` |
| CF Pages shows old version | Deployed without `--branch=prod` | Redeploy with `--branch=prod` flag |
| `VITE_API_BASE_URL` is wrong | GitHub variable not set or outdated | Update in GitHub → Settings → Variables → Actions |
| CORS error in browser console | `CORS_ALLOWED_ORIGINS` doesn't include your domain | Update Fly.io secret: `flyctl secrets set CORS_ALLOWED_ORIGINS="..."` |
| Supabase Security Advisor shows RLS errors | Application tables created without RLS | Run the `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` statements from Step 1c |

---

## Useful commands

```bash
# Check API status and health
flyctl status -a contest-platform-api
flyctl logs -a contest-platform-api --no-tail
curl https://api.origindraft.org/api/health

# View/update secrets
flyctl secrets list -a contest-platform-api
flyctl secrets set -a contest-platform-api KEY="value"

# SSH into the running machine (debugging)
flyctl ssh console -a contest-platform-api

# Redeploy after a config change
flyctl deploy -a contest-platform-api

# Manual frontend deploy
VITE_PLATFORM_MODE=production \
  VITE_API_BASE_URL=https://api.origindraft.org/api \
  pnpm --filter @origin-draft/web build
npx wrangler pages deploy apps/web/dist \
  --project-name=contest-platform-web --branch=prod --commit-dirty=true

# Check TLS certs
flyctl certs list -a contest-platform-api
flyctl certs show api.origindraft.org -a contest-platform-api
```
