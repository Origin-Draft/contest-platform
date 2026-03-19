# Architecture

## Overview

`contest-platform` is a single-repo TypeScript application with a Vite frontend and a Fastify-based headless API. Keycloak manages authentication and coarse-grained groups/roles, while the application enforces contest-specific authorization and workflow rules.

## Major components

- **Web app**: public marketing pages plus entrant, judge, and organizer experiences.
- **API**: REST endpoints for contests, submissions, judging, and result publication.
- **Shared package**: common types and schemas to keep UI and API contracts aligned.
- **PostgreSQL**: primary transactional datastore.
- **Keycloak**: identity provider for users, teams, and role-based access.
- **Cloudflare Tunnel**: secure ingress path for the single-host deployment model.

## Trust boundary

- Keycloak proves identity.
- The API maps identity claims to application permissions.
- The frontend never decides authorization on its own.

## Initial implementation priorities

1. Shared schemas and mock contest data.
2. API health and contest endpoints.
3. Web shell for the four primary user surfaces.
4. Docker Compose stack for local integration.

## Submission roadmap

- The next major data-model expansion is a **submission bundle** architecture that separates judged manuscripts from process provenance artifacts.
- See `docs/submission-bundle-plan.md` for the recommended storage model, policy modes, and phased implementation path.
