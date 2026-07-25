import type { NextFunction, Request, Response } from "express";
import { randomUUID } from "node:crypto";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Correlation id from client header or generated per request. */
      requestId: string;
    }
  }
}

/**
 * Attaches a stable requestId to every request. Reuses the client-supplied
 * X-Request-Id if it looks like a UUID; otherwise mints a new UUID v4.
 * Echoes the id back on the response so callers can correlate.
 */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function requestContext(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const incoming = req.header("x-request-id");
  const requestId = incoming && UUID_RE.test(incoming) ? incoming : randomUUID();
  req.requestId = requestId;
  res.setHeader("X-Request-Id", requestId);
  next();
}
