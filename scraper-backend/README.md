# Scraper Backend

Self-hosted, Playwright-ready scraper backend for the sourcing marketplace.
Standalone Node.js service. **Phase 3: endpoints only.** Every provider
endpoint currently returns HTTP `501 not_implemented`. No scraping, no
mock data.

Contract: see [`SCRAPER_BACKEND_SPEC.md`](../SCRAPER_BACKEND_SPEC.md) at the
repo root.

## Stack

- Node.js 20 + TypeScript (strict)
- Express 4
- Zod (validation)
- Helmet, CORS, compression
- Pino / pino-http (structured logging)
- express-rate-limit
- Docker (Ubuntu 24.04-compatible, multi-stage)

## Endpoints

| Method | Path                                    | Status                |
|--------|-----------------------------------------|-----------------------|
| GET    | `/v1/health`                            | 200 (public)          |
| GET    | `/v1/1688/search`                       | 501 not_implemented   |
| GET    | `/v1/1688/product/:id`                  | 501 not_implemented   |
| GET    | `/v1/1688/product/:id/variants`         | 501 not_implemented   |

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
    ├── config/
    │   └── env.ts              # Zod-validated environment
    ├── lib/
    │   ├── logger.ts           # Pino
    │   ├── response.ts         # Success / error envelope helpers
    │   └── http-error.ts       # Typed error class
    ├── middleware/
    │   ├── auth.ts             # Bearer / X-API-Key
    │   ├── error.ts            # Central error + 404 handlers
    │   ├── rate-limit.ts       # Global + per-endpoint buckets
    │   └── request-context.ts  # X-Request-Id propagation
    ├── routes/
    │   ├── v1.ts               # /v1 router
    │   └── health.ts           # /v1/health
    └── providers/
        └── sourcing1688/
            └── routes.ts       # /v1/1688/* (501 today)
```

## Local development

```bash
cp .env.example .env
# Edit API_KEYS at minimum.

npm install
npm run dev
```

Server listens on `http://localhost:8080`.

## Docker

```bash
docker compose build
docker compose up -d
docker compose logs -f scraper-backend
```

The container:

- Runs as non-root (`uid=1001`).
- Read-only root filesystem + tmpfs for `/tmp`.
- `HEALTHCHECK` hits `/v1/health` every 30s.
- Base image `node:20-bookworm-slim`, Ubuntu 24.04 compatible on the host.

### Phase 4 — Playwright

When Playwright lands, swap the runtime base image to
`mcr.microsoft.com/playwright:v<ver>-noble` (Ubuntu 24.04 Noble) or add
`RUN npx playwright install --with-deps chromium` in the runtime stage.
No route changes needed: each 501 handler is the seam.

## Verifying the deployment

```bash
# Health (no auth)
curl -s http://localhost:8080/v1/health | jq

# Auth failure
curl -s -i http://localhost:8080/v1/1688/search?q=speaker

# 501 with a valid key
curl -s -i -H "Authorization: Bearer <YOUR_KEY>" \
  "http://localhost:8080/v1/1688/search?q=speaker"
```

Every response includes `X-Request-Id`. Error payloads follow the envelope
in the spec (§4, §17).

## Environment variables

See [`.env.example`](./.env.example). Required: `API_KEYS`.

## Not in this phase

- Playwright / real scraping
- Response caching
- Persistent storage
- Metrics endpoint (planned: `/v1/metrics` behind an internal ACL)
