import express, { type Express } from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import pinoHttp from "pino-http";
import { env } from "./config/env.js";
import { logger } from "./lib/logger.js";
import { requestContext } from "./middleware/request-context.js";
import { errorMiddleware, notFoundHandler } from "./middleware/error.js";
import { v1Router } from "./routes/v1.js";

/**
 * Express app assembly. Kept free of side effects (no listen()) so it can
 * be imported by tests. The HTTP listener lives in server.ts.
 */
export function createApp(): Express {
  const app = express();

  app.disable("x-powered-by");
  app.set("trust proxy", 1); // behind Docker/reverse-proxy

  // Security & platform
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(
    cors({
      origin: env.CORS_ORIGINS.includes("*") ? true : env.CORS_ORIGINS,
      methods: ["GET", "OPTIONS"],
      allowedHeaders: [
        "Authorization",
        "Content-Type",
        "X-Api-Key",
        "X-Request-Id",
        "X-Client-Version",
        "Accept-Language",
      ],
      exposedHeaders: [
        "X-Request-Id",
        "RateLimit-Limit",
        "RateLimit-Remaining",
        "RateLimit-Reset",
        "Retry-After",
      ],
      maxAge: 600,
    }),
  );
  app.use(compression());
  app.use(express.json({ limit: "64kb" }));

  // Observability — attach requestId BEFORE the HTTP logger so it appears in logs.
  app.use(requestContext);
  app.use(
    pinoHttp({
      logger,
      customProps: (req) => ({ requestId: (req as { requestId?: string }).requestId }),
      customLogLevel: (_req, res, err) => {
        if (err || res.statusCode >= 500) return "error";
        if (res.statusCode >= 400) return "warn";
        return "info";
      },
      serializers: {
        req(req) {
          return { method: req.method, url: req.url };
        },
        res(res) {
          return { statusCode: res.statusCode };
        },
      },
    }),
  );

  // Routes
  app.use("/v1", v1Router);

  // 404 + error handling — always last.
  app.use(notFoundHandler);
  app.use(errorMiddleware);

  return app;
}
