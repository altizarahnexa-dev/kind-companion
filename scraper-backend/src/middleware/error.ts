import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { HttpError } from "../lib/http-error.js";
import { logger } from "../lib/logger.js";
import { sendError } from "../lib/response.js";

/**
 * Central error middleware. Converts anything thrown / next(err) into the
 * standard error envelope. Never leaks stack traces or internal messages
 * to the client.
 */
export function errorMiddleware(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
) {
  const provider =
    (req.params as { provider?: string }).provider ??
    // Extract from path like /v1/1688/... when available
    (req.path.split("/")[2] ?? "backend");

  if (err instanceof HttpError) {
    if (err.status >= 500) {
      logger.error(
        { requestId: req.requestId, code: err.code, details: err.details },
        err.message,
      );
    } else {
      logger.debug(
        { requestId: req.requestId, code: err.code },
        err.message,
      );
    }
    if (err.retryAfterMs) {
      res.setHeader("Retry-After", Math.ceil(err.retryAfterMs / 1000).toString());
    }
    sendError(res, {
      status: err.status,
      provider,
      requestId: req.requestId,
      code: err.code,
      message: err.message,
      retryable: err.retryable,
      retryAfterMs: err.retryAfterMs,
      details: err.details,
    });
    return;
  }

  if (err instanceof ZodError) {
    logger.debug(
      { requestId: req.requestId, issues: err.issues },
      "validation_error",
    );
    sendError(res, {
      status: 422,
      provider,
      requestId: req.requestId,
      code: "validation_error",
      message: "Request failed validation.",
      retryable: false,
      details: {
        issues: err.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
          code: i.code,
        })),
      },
    });
    return;
  }

  const e = err as { message?: string; stack?: string };
  logger.error(
    { requestId: req.requestId, err: { message: e?.message, stack: e?.stack } },
    "internal_error",
  );
  sendError(res, {
    status: 500,
    provider,
    requestId: req.requestId,
    code: "internal_error",
    message: "Internal server error.",
    retryable: true,
  });
}

export function notFoundHandler(req: Request, _res: Response, next: NextFunction) {
  next(
    new HttpError({
      status: 404,
      code: "not_found",
      message: `Route not found: ${req.method} ${req.path}`,
      retryable: false,
    }),
  );
}
