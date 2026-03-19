# Security Policy

## Reporting a vulnerability

If you discover a security vulnerability in Origin Draft, please report it responsibly.

**Do not open a public GitHub issue for security vulnerabilities.**

Instead, email **security@origindraft.org** with:

1. A description of the vulnerability
2. Steps to reproduce
3. The potential impact
4. Any suggested fix (optional)

We will acknowledge your report within 48 hours and aim to release a fix within 7 days for critical issues.

## Scope

This policy covers:

- The Origin Draft API (`apps/api`)
- The Origin Draft web frontend (`apps/web`)
- Infrastructure configuration (`infra/`, `fly.toml`, CI workflows)
- Supabase SQL setup scripts (`infra/supabase/`)

## Out of scope

- Third-party services (Supabase, Fly.io, Cloudflare) — report those to the respective vendor
- Social engineering attacks
- Denial of service attacks

## Recognition

We're happy to credit security researchers in our release notes (with your permission).
