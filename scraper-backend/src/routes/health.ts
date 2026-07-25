import { Router } from "express";
import { isAuthenticated } from "../lib/browser.js";

/**
 * GET /v1/health
 * Liveness + readiness probe. No auth, no rate limit, no cache.
 * `authenticated` is a best-effort flag derived from cookies present in
 * the shared persistent Chromium context.
 */
const startedAt = Date.now();

export const healthRouter: Router = Router();

healthRouter.get("/health", async (_req, res) => {
  const authenticated = await isAuthenticated().catch(() => false);
  res.status(200).json({
    ok: true,
    service: "scraper-backend",
    version: process.env.npm_package_version ?? "1.0.0",
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    authenticated,
    providers: {
      "1688":     { enabled: true,  healthy: true,  implemented: true,  authenticated },
      alibaba:    { enabled: false, healthy: false, implemented: false, authenticated: false },
      taobao:     { enabled: false, healthy: false, implemented: false, authenticated: false },
      aliexpress: { enabled: false, healthy: false, implemented: false, authenticated: false },
    },
  });
});
