# syntax=docker/dockerfile:1.7

# -----------------------------------------------------------------------------
# Scraper Backend — Dockerfile
# Playwright-ready. Base image is Microsoft's official Playwright image on
# Ubuntu 24.04 (Noble), which ships Chromium + all system libs preinstalled.
# Multi-stage: (1) install deps + build TS, (2) minimal runtime image.
# -----------------------------------------------------------------------------

# Pin Playwright version — MUST match the "playwright" version in package.json.
ARG PLAYWRIGHT_VERSION=v1.61.1

########################
# Stage 1 — build
########################
FROM mcr.microsoft.com/playwright:${PLAYWRIGHT_VERSION}-noble AS build

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund

COPY tsconfig.json ./
COPY src ./src

RUN npm run build \
 && npm prune --omit=dev

########################
# Stage 2 — runtime
########################
FROM mcr.microsoft.com/playwright:${PLAYWRIGHT_VERSION}-noble AS runtime

ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0 \
    # Use the browsers already baked into the base image.
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# tini for correct signal forwarding + curl for HEALTHCHECK.
RUN apt-get update \
 && apt-get install -y --no-install-recommends tini curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# The playwright base image ships a `pwuser` non-root user (uid 1001).
# Reuse it instead of creating our own.
WORKDIR /app

# Pre-create /data and hand ownership to pwuser so the mounted volume
# inherits the correct permissions on first run. Docker copies the
# ownership of the mountpoint directory into a fresh named volume.
RUN mkdir -p /data/browser-profile \
 && chown -R pwuser:pwuser /data

COPY --from=build --chown=pwuser:pwuser /app/node_modules ./node_modules
COPY --from=build --chown=pwuser:pwuser /app/dist ./dist
COPY --chown=pwuser:pwuser package.json ./

USER pwuser

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
    CMD curl -fsS "http://127.0.0.1:${PORT}/v1/health" || exit 1

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/server.js"]
