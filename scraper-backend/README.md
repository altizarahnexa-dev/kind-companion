# Scraper Backend

Self-hosted, Playwright-ready scraper backend for the sourcing marketplace.
Standalone Node.js service.

**Phase 4.1 status:** Playwright infrastructure is wired. A diagnostic
endpoint proves Chromium can launch and load a page inside the Docker
container. Provider endpoints still return `501 not_implemented` — no
scraping, no product extraction, no mock data.

Contract for provider endpoints: see
[`../SCRAPER_BACKEND_SPEC.md`](../SCRAPER_BACKEND_SPEC.md).

## Stack

- Node.js 20 + TypeScript (strict)
- Express 4
- Playwright (Chromium)
- Zod (validation)
- Helmet, CORS, compression
- Pino / pino-http (structured logging)
- express-rate-limit
- Docker on `mcr.microsoft.com/playwright:v1.47.2-noble` (Ubuntu 24.04)

## Endpoints

| Method | Path                                    | Status                  |
|--------|-----------------------------------------|-------------------------|
| GET    | `/v1/health`                            | 200 (public)            |
| GET    | `/v1/diagnostics/browser`               | 200 (Playwright probe)  |
| GET    | `/v1/1688/search`                       | 501 not_implemented     |
| GET    | `/v1/1688/product/:id`                  | 501 not_implemented     |
| GET    | `/v1/1688/product/:id/variants`         | 501 not_implemented     |

All `/v1/*` routes except `/v1/health` require an API key:

```
Authorization: Bearer <key>       # preferred
X-API-Key: <key>                  # alternative
```

## Folder structure

```
scraper-backend/
├── Dockerfile
├── docker-compose.yml
├── package.json
├── tsconfig.json
├── .env.example
└── src/
    ├── server.ts               # HTTP listener + graceful shutdown
    ├── app.ts                  # Express app assembly (no side effects)
    ├── config/env.ts           # Zod-validated environment
    ├── lib/
    │   ├── browser.ts          # Playwright Chromium singleton + withContext()
    │   ├── logger.ts           # Pino
    │   ├── response.ts         # Envelope helpers
    │   └── http-error.ts       # Typed error class
    ├── middleware/
    │   ├── auth.ts             # Bearer / X-API-Key
    │   ├── error.ts            # Central error + 404 handlers
    │   ├── rate-limit.ts       # Global + per-endpoint buckets
    │   └── request-context.ts  # X-Request-Id propagation
    ├── routes/
    │   ├── v1.ts               # /v1 router
    │   ├── health.ts           # /v1/health
    │   └── diagnostics.ts      # /v1/diagnostics/browser
    └── providers/
        └── sourcing1688/
            └── routes.ts       # /v1/1688/* (501 today)
```

## Local development

```bash
cp .env.example .env
# Edit API_KEYS at minimum.

npm install
# One-time: download Chromium into the local Playwright cache.
npx playwright install chromium

npm run dev
```

Server listens on `http://localhost:8080`.

## Docker (Ubuntu 24.04 Noble base)

```bash
docker compose build
docker compose up -d
docker compose logs -f scraper-backend
```

The container:

- Base image: `mcr.microsoft.com/playwright:v1.47.2-noble`
  (Chromium + all system libs preinstalled).
- Runs as the built-in non-root `pwuser`.
- `/tmp` on tmpfs, `/dev/shm` sized to 1 GB (Chromium needs this).
- `HEALTHCHECK` hits `/v1/health` every 30s.

## Verifying Playwright works

```bash
# 1. Health — no auth
curl -s http://localhost:8080/v1/health | jq

# 2. Auth failure — 401 envelope
curl -s -i http://localhost:8080/v1/diagnostics/browser

# 3. Real browser probe — loads https://www.1688.com and returns:
#    { "success": true, "title": "...", "url": "...", "load_time_ms": 1234 }
curl -s -H "Authorization: Bearer <YOUR_KEY>" \
  "http://localhost:8080/v1/diagnostics/browser" | jq

# 4. Provider endpoints — still 501 not_implemented
curl -s -i -H "Authorization: Bearer <YOUR_KEY>" \
  "http://localhost:8080/v1/1688/search?q=speaker"
```

On failure, `/v1/diagnostics/browser` returns the standard error envelope
from the spec (§4, §17) — typically `504 upstream_timeout` or
`502 upstream_unavailable`.

## Environment variables

See [`.env.example`](./.env.example). Required: `API_KEYS`.

Playwright-specific (already in `.env.example`):

- `PLAYWRIGHT_HEADLESS` — `true` in production.
- `PLAYWRIGHT_BROWSER` — `chromium` (only option wired today).
- `PLAYWRIGHT_PROXY_URL` — optional upstream proxy.

## Not in this phase

- Actual scraping / DOM parsing / product extraction
- Response caching
- Persistent storage
- Metrics endpoint
