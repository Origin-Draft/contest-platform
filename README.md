# Origin Draft

[![CI](https://github.com/Origin-Draft/contest-platform/actions/workflows/ci.yml/badge.svg)](https://github.com/Origin-Draft/contest-platform/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

An open-source platform for running AI-assisted writing contests. Built with React, Fastify, PostgreSQL, and Supabase.

**Live at [origindraft.org](https://origindraft.org)**

## Features

- **Contest discovery** — public contest listings with stage-based lifecycle
- **Entrant portal** — account creation, team submissions, manuscript upload
- **Judge portal** — blind scoring with configurable rubrics
- **Organizer admin** — contest CRUD, stage management, results publishing
- **AI disclosure** — per-contest AI usage policy enforcement
- **Role-based access** — platform-admin, organizer, judge, entrant roles via JWT

## Tech stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, Vite, TypeScript |
| API | Fastify, Node 22 |
| Database | PostgreSQL (Supabase or self-hosted) |
| Auth | Supabase Auth or Keycloak |
| Storage | Supabase Storage or local filesystem |
| Shared types | `@origin-draft/shared` workspace package |

## Quick start

```bash
# Clone and install
git clone https://github.com/Origin-Draft/contest-platform.git
cd contest-platform
pnpm install

# Start in demo mode (no external services needed)
cp .env.demo.example .env
pnpm dev
```

This starts the API on `http://localhost:4000` and the web app on `http://localhost:5173` with auth bypass enabled for local testing.

## Project structure

```
apps/
  api/          Fastify API server
  web/          Vite + React frontend
packages/
  shared/       Shared domain types and schemas
infra/
  docker-compose.yml
  keycloak/     Keycloak theme and realm template
  supabase/     Supabase SQL setup scripts
docs/           Architecture and deployment guides
```

## Deployment

Two deployment paths are supported:

| Path | Guide |
|------|-------|
| **Cloud (recommended)** | [Fly.io + Supabase + Cloudflare Pages](docs/deploy-supabase-fly-cf.md) — free tier |
| **Self-hosted** | [Docker Compose + Cloudflare Tunnel](docs/production-deployment.md) — VPS |

## Operating modes

| Mode | Auth | Use case |
|------|------|----------|
| `demo` | Dev bypass (in-browser role switching) | Local demos, quick testing |
| `development` | Keycloak | Local development with real auth |
| `production` | Supabase Auth or Keycloak | Production deployment |

Each mode has a matching env file: `.env.demo.example`, `.env.dev.example`, `.env.production.example`.

## Scripts

| Command | Description |
|---------|------------|
| `pnpm dev` | Start API + web concurrently |
| `pnpm build` | Build all packages |
| `pnpm test:api` | Run API unit tests |
| `pnpm typecheck` | TypeScript type checking |
| `pnpm docker:up` | Start the Docker Compose stack |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and PR guidelines.

## Security

Report vulnerabilities privately — see [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
