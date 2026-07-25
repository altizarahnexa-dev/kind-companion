import rateLimit, { type Options } from "express-rate-limit";
import type { Request } from "express";
import { env } from "../config/env.js";
import { sendError } from "../lib/response.js";

/**
 * Per-API-key rate limiting. Keys are hashed via the Authorization header
 * so anonymous callers (which will 401 anyway) share a single bucket.
 */
function keyGenerator(req: Request): string {
  const auth = req.header("authorization") ?? req.header("x-api-key") ?? "";
  return auth || (req.ip ?? "anonymous");
}

function makeHandler(): Options["handler"] {
  return (req, res, _next, options) => {
    const retryAfterMs = Math.max(0, options.windowMs);
    res.setHeader("Retry-After", Math.ceil(retryAfterMs / 1000).toString());
    sendError(res, {
      status: 429,
      provider: (req.params as { provider?: string }).provider ?? "backend",
      requestId: req.requestId,
      code: "rate_limited",
      message: "Rate limit exceeded.",
      retryable: true,
      retryAfterMs,
    });
  };
}

export const globalLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.RATE_LIMIT_MAX,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator,
  handler: makeHandler(),
});

export const searchLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.RATE_LIMIT_SEARCH_MAX,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator,
  handler: makeHandler(),
});

export const productLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.RATE_LIMIT_PRODUCT_MAX,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator,
  handler: makeHandler(),
});
