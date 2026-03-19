# Production Deployment Guide

This guide covers deploying Origin Draft on a single VPS using Docker Compose with Cloudflare Tunnel for TLS/edge.

## Prerequisites

- Linux VPS (Ubuntu 22.04+ recommended) with ≥ 2 GB RAM, ≥ 20 GB disk
- Docker Engine 24+ and Docker Compose v2
- A Cloudflare account with a domain (for Tunnel-based TLS)
- Git access to this repository

## Architecture

```
Internet → Cloudflare Tunnel → cloudflared container
                                  ├─→ web  (Vite preview, port 4173)
                                  └─→ api  (Fastify, port 4000)
                                        ├─→ postgres (app DB)
                                        └─→ keycloak (auth)
                                              └─→ keycloak-postgres
```

All services run in a single Docker Compose stack. Postgres and Keycloak ports are bound to `127.0.0.1` only — they are never exposed to the internet. Cloudflare Tunnel handles TLS termination.

## Step 1: Clone and configure

```bash
git clone <repo-url> contest-platform
cd contest-platform
cp .env.production.example .env
```

Edit `.env` and replace **every** placeholder value. The API will refuse to start if any `change-me` or `example.com` values remain.

### Required values to change

| Variable | What to set |
|----------|-------------|
| `POSTGRES_PASSWORD` | Strong random password |
| `KEYCLOAK_ADMIN_PASSWORD` | Strong random password |
| `KEYCLOAK_DB_PASSWORD` | Strong random password |
| `DATABASE_URL` | Update password to match `POSTGRES_PASSWORD` |
| `CONTAINER_DATABASE_URL` | Same as `DATABASE_URL` |
| `CORS_ALLOWED_ORIGINS` | Your public domain, e.g. `https://contest.yourdomain.com` |
| `KEYCLOAK_ISSUER_URL` | `https://auth.yourdomain.com/realms/contest-platform` |
| `WEB_ORIGIN` | `https://contest.yourdomain.com` |
| `KEYCLOAK_REDIRECT_URIS_JSON` | `["https://contest.yourdomain.com/*"]` |
| `KEYCLOAK_WEB_ORIGINS_JSON` | `["https://contest.yourdomain.com"]` |
| `KEYCLOAK_HOSTNAME` | `https://auth.yourdomain.com` |
| `VITE_API_BASE_URL` | `https://contest.yourdomain.com/api` |
| `CLOUDFLARE_TUNNEL_TOKEN` | Token from Cloudflare Zero Trust dashboard |

### Generating strong passwords

```bash
openssl rand -base64 24   # run once per password
```

## Step 2: Set up Cloudflare Tunnel

1. In Cloudflare Zero Trust → Networks → Tunnels, create a tunnel
2. Copy the tunnel token into `CLOUDFLARE_TUNNEL_TOKEN` in `.env`
3. Add two public hostnames to the tunnel:
   - `contest.yourdomain.com` → `http://web:4173`
   - `auth.yourdomain.com` → `http://keycloak:8080`
4. If API and web share a domain, add a rule for `/api/*` → `http://api:4000`

## Step 3: Deploy

```bash
# Start everything including the Cloudflare tunnel
docker compose -f infra/docker-compose.yml --profile tunnel up -d --build
```

Or use the Makefile:
```bash
make deploy   # starts without tunnel profile
# To include tunnel:
docker compose -f infra/docker-compose.yml --profile tunnel up -d --build
```

### Verify startup

```bash
# Check all containers are healthy
docker compose -f infra/docker-compose.yml ps

# Check API health
make health

# Run smoke tests
make smoke-test
```

## Step 4: Create the first admin user

1. Open `https://auth.yourdomain.com` and sign in with `KEYCLOAK_ADMIN` / `KEYCLOAK_ADMIN_PASSWORD`
2. Navigate to the `contest-platform` realm → Users
3. Create your first organizer user and assign the `organizer` realm role
4. Optionally assign `platform-admin` for full access

## Routine Operations

### Viewing logs

```bash
make logs                             # tail all services
docker compose -f infra/docker-compose.yml logs api -f   # API only
```

### Backups

```bash
make backup                           # creates infra/backups/<timestamp>/
```

Backups include:
- `app-db.dump` — app Postgres (pg_dump custom format)
- `keycloak-db.dump` — Keycloak Postgres
- `uploads.tar.gz` — uploaded artifacts

Copy the backup directory off-server regularly.

### Restore

```bash
make restore DIR=infra/backups/20260319-120000
```

This replaces all data. A 5-second abort window is provided.

### Updates

```bash
git pull origin main
docker compose -f infra/docker-compose.yml up -d --build
make smoke-test
```

### Database migrations

```bash
make migrate                          # runs drizzle-kit push
```

## Security Checklist

- [ ] All placeholder passwords replaced with strong random values
- [ ] `AUTH_DEV_BYPASS=false` (enforced by startup validation)
- [ ] `KEYCLOAK_SSL_REQUIRED=external`
- [ ] `KEYCLOAK_HOSTNAME_STRICT=true`
- [ ] Postgres and Keycloak ports bound to `127.0.0.1` (default in docker-compose.yml)
- [ ] Cloudflare Tunnel token kept secret
- [ ] Backups running on a schedule (cron)
- [ ] Backup files stored off-server
- [ ] Server firewall allows only 22 (SSH) inbound — all HTTP traffic goes through the tunnel

## Cron Backup Example

```cron
# Daily backup at 3 AM, keep 14 days
0 3 * * * cd /opt/contest-platform && ./infra/backup.sh && find infra/backups -maxdepth 1 -type d -mtime +14 -exec rm -rf {} +
```

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| API refuses to start | Check logs: `docker compose logs api`. Usually a missing or placeholder env var. |
| Keycloak "HTTPS required" | Set `KEYCLOAK_SSL_REQUIRED=external` and `KC_PROXY_HEADERS=xforwarded` |
| CORS errors in browser | Ensure `CORS_ALLOWED_ORIGINS` matches your public domain exactly |
| Token validation fails | Ensure `KEYCLOAK_ISSUER_URL` uses the public hostname, not `localhost` |
| Upload fails with 413 | Increase `UPLOAD_MAX_BYTES` (default 50 MB) |
