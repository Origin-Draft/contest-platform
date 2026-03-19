# Cloudflare Tunnel

This stack uses token-based tunnel startup for the first deployment pass.

## Usage

1. Create a Cloudflare Tunnel in the Cloudflare dashboard.
2. Route your desired hostname(s) to the local `web` and `api` services.
3. Put the tunnel token into `.env` as `CLOUDFLARE_TUNNEL_TOKEN`.
4. Start the tunnel profile with Docker Compose:
   - `docker compose -f infra/docker-compose.yml --profile tunnel up`

## Recommended public hostnames

- `app.example.com` → web frontend
- `api.example.com` → headless API

A more advanced ingress config can be added later if we want one tunnel process to manage multiple hostnames declaratively.
