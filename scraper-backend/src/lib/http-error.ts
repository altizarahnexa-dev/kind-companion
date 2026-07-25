/**
 * Typed HTTP error. Thrown from routes/middleware; caught by the central
 * error middleware in src/middleware/error.ts and rendered into the
 * standard error envelope.
 */
export class HttpError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly retryable: boolean;
  public readonly retryAfterMs?: number;
  public readonly details?: Record<string, unknown>;

  constructor(opts: {
    status: number;
    code: string;
    message: string;
    retryable?: boolean;
    retryAfterMs?: number;
    details?: Record<string, unknown>;
  }) {
    super(opts.message);
    this.name = "HttpError";
    this.status = opts.status;
    this.code = opts.code;
    this.retryable = opts.retryable ?? opts.status >= 500;
    this.retryAfterMs = opts.retryAfterMs;
    this.details = opts.details;
  }

  static notImplemented(feature: string) {
    return new HttpError({
      status: 501,
      code: "not_implemented",
      message: `${feature} is not implemented yet.`,
      retryable: false,
    });
  }

  static badRequest(message: string, details?: Record<string, unknown>) {
    return new HttpError({
      status: 400,
      code: "bad_request",
      message,
      retryable: false,
      details,
    });
  }

  static validation(message: string, details?: Record<string, unknown>) {
    return new HttpError({
      status: 422,
      code: "validation_error",
      message,
      retryable: false,
      details,
    });
  }

  static unauthorized(message = "Missing or invalid API key.") {
    return new HttpError({
      status: 401,
      code: "unauthorized",
      message,
      retryable: false,
    });
  }

  static notFound(message = "Resource not found.") {
    return new HttpError({
      status: 404,
      code: "not_found",
      message,
      retryable: false,
    });
  }

  static rateLimited(retryAfterMs: number) {
    return new HttpError({
      status: 429,
      code: "rate_limited",
      message: "Rate limit exceeded.",
      retryable: true,
      retryAfterMs,
    });
  }
}
