import pino from "pino";
import { env } from "../config/env.js";

/**
 * Structured logger. In dev we pretty-print; in production we emit JSON so
 * log aggregators (Loki, CloudWatch, Datadog, …) can parse cleanly.
 * Never log secrets or full request bodies here.
 */
export const logger = pino({
  level: env.LOG_LEVEL,
  base: { service: "scraper-backend" },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "req.headers['x-api-key']",
      "res.headers['set-cookie']",
    ],
    censor: "[redacted]",
  },
  // pino-pretty is a devDependency and is pruned from the production image.
  // Only enable it when explicitly requested AND running in development,
  // so `npm prune --omit=dev` cannot break boot.
  transport:
    env.NODE_ENV === "development" && env.LOG_PRETTY
      ? {
          target: "pino-pretty",
          options: { colorize: true, translateTime: "SYS:standard" },
        }
      : undefined,
});
