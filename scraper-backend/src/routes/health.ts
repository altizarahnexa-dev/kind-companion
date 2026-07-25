import { Router } from "express";

/**
 * GET /v1/health
 * Liveness + readiness probe. No auth, no rate limit, no cache.
 * Shape matches SCRAPER_BACKEND_SPEC.md §6.
 */
const startedAt = Date.now();

export const healthRouter: Router = Router();

healthRouter.get("/health", (_req, res) => {
  res.status(200).json({
    ok: true,
    service: "scraper-backend",
    version: process.env.npm_package_version ?? "1.0.0",
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    providers: {
      "1688":       { enabled: true,  healthy: true,  implemented: true  },
      alibaba:      { enabled: false, healthy: false, implemented: false },
      taobao:       { enabled: false, healthy: false, implemented: false },
      aliexpress:   { enabled: false, healthy: false, implemented: false },
    },
  });
});
