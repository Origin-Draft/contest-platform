# Contributing to Origin Draft

Thanks for your interest in contributing! This document covers the basics.

## Getting started

1. Fork the repo and clone your fork
2. Install dependencies: `pnpm install`
3. Copy an env file: `cp .env.demo.example .env`
4. Start the dev stack: `pnpm dev` (or `make demo` for the Docker flow)

## Development workflow

- **Build all packages:** `pnpm build`
- **Run API tests:** `pnpm test:api`
- **Typecheck:** `pnpm typecheck`
- **Start API + web concurrently:** `pnpm dev`

## Project structure

| Directory | What it is |
|-----------|-----------|
| `apps/api` | Fastify API server |
| `apps/web` | Vite + React frontend |
| `packages/shared` | Shared types and schemas |
| `infra/` | Docker Compose, Keycloak config, Supabase SQL |
| `docs/` | Architecture and deployment guides |

## Pull requests

- Create a branch from `main`
- Keep PRs focused — one feature or fix per PR
- Make sure `pnpm build && pnpm typecheck && pnpm test:api` all pass
- Write a clear description of what changed and why

## Commit messages

We use conventional commits:

- `feat:` — new feature
- `fix:` — bug fix
- `docs:` — documentation only
- `chore:` — build, deps, CI changes
- `refactor:` — code change that doesn't fix a bug or add a feature

## Reporting bugs

Open a GitHub issue with:

1. What you expected to happen
2. What actually happened
3. Steps to reproduce
4. Your environment (OS, Node version, browser)

## Security vulnerabilities

Please report security issues privately — see [SECURITY.md](SECURITY.md).
