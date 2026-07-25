import type { NextFunction, Request, Response } from "express";
import { timingSafeEqual } from "node:crypto";
import { env } from "../config/env.js";
import { HttpError } from "../lib/http-error.js";

/**
 * API key authentication. Accepts either:
 *   Authorization: Bearer <token>
 *   X-API-Key: <token>
 *
 * Compares in constant time against the configured API_KEYS list. Health
 * endpoint is exempt (mounted before this middleware).
 */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function extractToken(req: Request): string | null {
  const auth = req.header("authorization");
  if (auth) {
    const [scheme, value] = auth.split(" ");
    if (scheme && value && scheme.toLowerCase() === "bearer") {
      return value.trim();
    }
  }
  const headerKey = req.header("x-api-key");
  if (headerKey) return headerKey.trim();
  return null;
}

export function apiKeyAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
) {
  const token = extractToken(req);
  if (!token) {
    return next(HttpError.unauthorized("Missing API key."));
  }
  const ok = env.API_KEYS.some((k) => safeEqual(k, token));
  if (!ok) {
    return next(HttpError.unauthorized("Invalid API key."));
  }
  return next();
}
