import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { logger } from "./lib/logger.js";
import { closeBrowser } from "./lib/browser.js";

/**
 * HTTP entry point. Graceful shutdown on SIGINT / SIGTERM so Docker stops
 * cleanly and in-flight requests finish (up to 10s).
 */
const app = createApp();

const server = app.listen(env.PORT, env.HOST, () => {
  logger.info(
    { host: env.HOST, port: env.PORT, env: env.NODE_ENV },
    "scraper-backend listening",
  );
});

function shutdown(signal: string) {
  logger.info({ signal }, "shutting down");
  const forceExit = setTimeout(() => {
    logger.warn("forced exit after 10s");
    process.exit(1);
  }, 10_000);
  forceExit.unref();

  server.close(async (err) => {
    if (err) {
      logger.error({ err }, "error during shutdown");
      process.exit(1);
    }
    await closeBrowser();
    logger.info("closed cleanly");
    process.exit(0);
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

process.on("unhandledRejection", (reason) => {
  logger.error({ reason }, "unhandledRejection");
});
process.on("uncaughtException", (err) => {
  logger.fatal({ err }, "uncaughtException");
  process.exit(1);
});
