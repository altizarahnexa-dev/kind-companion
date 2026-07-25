import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { HttpError } from "../lib/http-error.js";
import { withContext } from "../lib/browser.js";
import { logger } from "../lib/logger.js";
import { env } from "../config/env.js";

/**
 * Diagnostics routes — used to verify Playwright works end-to-end in the
 * deployed container. NOT part of the sourcing contract (SCRAPER_BACKEND_SPEC).
 *
 * Phase 4.1: only /v1/diagnostics/browser exists. It proves the browser
 * can launch, load 1688's homepage, and read a title. No parsing, no
 * product extraction, no search.
 */

const QuerySchema = z.object({
  url: z.string().url().optional(),
  timeoutMs: z.coerce.number().int().min(1000).max(60_000).optional(),
});

const DEFAULT_URL = "https://www.1688.com";

export const diagnosticsRouter: Router = Router();

diagnosticsRouter.get(
  "/browser",
  async (req: Request, res: Response, next: NextFunction) => {
    (req.params as { provider?: string }).provider = "diagnostics";
    try {
      const query = QuerySchema.parse(req.query);
      const targetUrl = query.url ?? DEFAULT_URL;
      const timeoutMs = query.timeoutMs ?? env.UPSTREAM_TIMEOUT_MS;

      logger.info(
        { requestId: req.requestId, targetUrl, timeoutMs },
        "diagnostics: opening page",
      );

      const startedAt = Date.now();
      const result = await withContext(async (ctx) => {
        const page = await ctx.newPage();
        // "load" fires after the main document + subresources; good enough
        // to prove the browser rendered a real page.
        const response = await page.goto(targetUrl, {
          waitUntil: "load",
          timeout: timeoutMs,
        });
        const title = await page.title();
        const finalUrl = page.url();
        const status = response?.status() ?? 0;
        await page.close();
        return { title, url: finalUrl, status };
      });
      const loadTimeMs = Date.now() - startedAt;

      logger.info(
        { requestId: req.requestId, loadTimeMs, status: result.status },
        "diagnostics: page loaded",
      );

      // Intentionally NOT wrapped in the SCRAPER_BACKEND_SPEC envelope —
      // this is a raw diagnostic ping with the shape the caller asked for.
      res.status(200).json({
        success: true,
        title: result.title,
        url: result.url,
        load_time_ms: loadTimeMs,
        upstream_status: result.status,
      });
    } catch (err) {
      // Playwright errors → mapped to spec-style envelope via next().
      const e = err as { name?: string; message?: string };
      if (e?.name === "TimeoutError") {
        return next(
          new HttpError({
            status: 504,
            code: "upstream_timeout",
            message: "Browser timed out loading the page.",
            retryable: true,
            details: { cause: e.message },
          }),
        );
      }
      if (
        e?.message?.includes("net::ERR_") ||
        e?.message?.includes("NS_ERROR_") ||
        e?.name === "Error"
      ) {
        return next(
          new HttpError({
            status: 502,
            code: "upstream_unavailable",
            message: "Browser could not reach the target URL.",
            retryable: true,
            details: { cause: e.message },
          }),
        );
      }
      return next(err);
    }
  },
);
