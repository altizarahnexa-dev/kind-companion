# syntax=docker/dockerfile:1.7

# -----------------------------------------------------------------------------
# Scraper Backend — Dockerfile
# Ubuntu 24.04 compatible. Ready for Playwright (browsers installed in Phase 4).
# Multi-stage: (1) install deps + build TS, (2) minimal runtime image.
# -----------------------------------------------------------------------------

ARG NODE_VERSION=20.14.0

########################
# Stage 1 — build
########################
FROM node:${NODE_VERSION}-bookworm-slim AS build

WORKDIR /app

# Install build essentials only for the build stage
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund

COPY tsconfig.json ./
COPY src ./src

RUN npm run build \
 && npm prune --omit=dev

########################
# Stage 2 — runtime
########################
FROM node:${NODE_VERSION}-bookworm-slim AS runtime

ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0

# System deps kept minimal here. When Playwright lands (Phase 4), swap this
# base for `mcr.microsoft.com/playwright:v1.<ver>-noble` (Ubuntu 24.04 Noble)
# or install browser dependencies via `npx playwright install --with-deps`.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates tini curl \
    && rm -rf /var/lib/apt/lists/*

# Non-root user
RUN groupadd --system --gid 1001 app \
 && useradd --system --uid 1001 --gid app --home /home/app --create-home app

WORKDIR /app

COPY --from=build --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/dist ./dist
COPY --chown=app:app package.json ./

USER app

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD curl -fsS "http://127.0.0.1:${PORT}/v1/health" || exit 1

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/server.js"]
