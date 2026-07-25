import type { Response } from "express";

/**
 * Standard success / error envelopes matching SCRAPER_BACKEND_SPEC.md §4.
 * Every route must return via these helpers — no ad-hoc res.json calls.
 */

export interface CacheMeta {
  hit: boolean;
  ageSeconds: number;
  ttlSeconds: number;
  staleWhileRevalidateSeconds?: number;
}

export interface SuccessEnvelope<TData, TMeta = Record<string, unknown>> {
  ok: true;
  provider: string;
  requestId: string;
  cache: CacheMeta;
  data: TData;
  meta?: TMeta;
}

export interface ErrorEnvelope {
  ok: false;
  provider: string;
  requestId: string;
  error: {
    code: string;
    message: string;
    retryable: boolean;
    retryAfterMs?: number;
    details?: Record<string, unknown>;
  };
}

export function sendSuccess<TData, TMeta = Record<string, unknown>>(
  res: Response,
  payload: {
    status?: number;
    provider: string;
    requestId: string;
    data: TData;
    meta?: TMeta;
    cache?: Partial<CacheMeta>;
  },
) {
  const envelope: SuccessEnvelope<TData, TMeta> = {
    ok: true,
    provider: payload.provider,
    requestId: payload.requestId,
    cache: {
      hit: false,
      ageSeconds: 0,
      ttlSeconds: 0,
      ...payload.cache,
    },
    data: payload.data,
    meta: payload.meta,
  };
  res.status(payload.status ?? 200).json(envelope);
}

export function sendError(
  res: Response,
  payload: {
    status: number;
    provider: string;
    requestId: string;
    code: string;
    message: string;
    retryable: boolean;
    retryAfterMs?: number;
    details?: Record<string, unknown>;
  },
) {
  const envelope: ErrorEnvelope = {
    ok: false,
    provider: payload.provider,
    requestId: payload.requestId,
    error: {
      code: payload.code,
      message: payload.message,
      retryable: payload.retryable,
      retryAfterMs: payload.retryAfterMs,
      details: payload.details,
    },
  };
  res.status(payload.status).json(envelope);
}
