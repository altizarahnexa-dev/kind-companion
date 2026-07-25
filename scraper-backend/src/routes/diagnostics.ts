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
 * Phase 4.1: /v1/diagnostics/browser — proves Chromium can load a page.
 * Phase 4.2: /v1/diagnostics/search  — proves Chromium can drive the
 *   1688 search form and land on the results page. No HTML extraction,
 *   no parsing, no persistence.
 */

/** Map a Playwright error to the spec error envelope. */
function mapPlaywrightError(err: unknown): unknown {
  const e = err as { name?: string; message?: string };
  if (e?.name === "TimeoutError") {
    return new HttpError({
      status: 504,
      code: "upstream_timeout",
      message: "Browser timed out while navigating.",
      retryable: true,
      details: { cause: e.message },
    });
  }
  if (
    e?.message?.includes("net::ERR_") ||
    e?.message?.includes("NS_ERROR_")
  ) {
    return new HttpError({
      status: 502,
      code: "upstream_unavailable",
      message: "Browser could not reach the target URL.",
      retryable: true,
      details: { cause: e.message },
    });
  }
  return err;
}

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
      // 1688 is heavy with ads/analytics; waiting for full "load" often
      // exceeds 15s. Use domcontentloaded + a usability probe instead.
      const timeoutMs = query.timeoutMs ?? 45_000;

      logger.info(
        { requestId: req.requestId, targetUrl, timeoutMs },
        "diagnostics: opening page",
      );

      const startedAt = Date.now();
      const result = await withContext(async (ctx) => {
        const page = await ctx.newPage();
        // Don't wait for every subresource. DOMContentLoaded is enough to
        // prove the browser reached the page; then confirm usability by
        // waiting for either <body> or the search input.
        const response = await page.goto(targetUrl, {
          waitUntil: "domcontentloaded",
          timeout: timeoutMs,
        });
        await Promise.race([
          page.locator("body").first().waitFor({ state: "attached", timeout: timeoutMs }),
          page
            .locator('input[name="keywords"], input.mod-searchbar-input, input#alisearch-input')
            .first()
            .waitFor({ state: "visible", timeout: timeoutMs }),
        ]).catch(() => {});
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

// ---------------------------------------------------------------------------
// Phase 4.2 — Search navigation diagnostic
// ---------------------------------------------------------------------------

const SearchQuerySchema = z.object({
  keyword: z.string().min(1).max(200),
  timeoutMs: z.coerce.number().int().min(1000).max(60_000).optional(),
});

const HOMEPAGE_URL = "https://www.1688.com";

/**
 * Candidate selectors for 1688's homepage search input. 1688 A/Bs their
 * homepage frequently, so we try a handful and use the first visible match.
 * Order = specificity, most specific first.
 */
const SEARCH_INPUT_SELECTORS = [
  'input[name="keywords"]',
  'input.mod-searchbar-input',
  'input#alisearch-input',
  'input[placeholder*="搜"]',
  '#home-header input[type="text"]',
];

/**
 * URL patterns that indicate we successfully landed on a search results page.
 * We only *check* the URL here — we do NOT extract anything from the page.
 */
const RESULTS_URL_PATTERN = /(s\.1688\.com|offer_search|\/selloffer\/)/i;

/**
 * Shared search-navigation helper. Loads the 1688 homepage, submits the
 * keyword, and waits until the results page URL is reached and the page
 * has finished loading. Throws HttpError on unrecoverable problems.
 *
 * Kept here so Phase 4.2 (`/search`) and Phase 4.3 (`/search-extract`)
 * behave identically — navigation is not duplicated between routes.
 */
async function navigateToSearchResults(
  page: import("playwright").Page,
  keyword: string,
  timeoutMs: number,
): Promise<void> {
  // 1. Load the homepage.
  await page.goto(HOMEPAGE_URL, {
    waitUntil: "domcontentloaded",
    timeout: timeoutMs,
  });

  // 2. Find the first visible search input.
  let filled = false;
  for (const selector of SEARCH_INPUT_SELECTORS) {
    const input = page.locator(selector).first();
    try {
      await input.waitFor({ state: "visible", timeout: 3_000 });
      await input.fill(keyword);
      filled = true;
      break;
    } catch {
      // try next selector
    }
  }
  if (!filled) {
    throw new HttpError({
      status: 502,
      code: "upstream_unavailable",
      message:
        "Search input not found on 1688 homepage. Selectors may be stale.",
      retryable: true,
    });
  }

  // 3. Submit and wait for the results URL.
  await Promise.all([
    page.waitForURL(RESULTS_URL_PATTERN, { timeout: timeoutMs }),
    page.keyboard.press("Enter"),
  ]);

  // 4. Wait until the results page is fully loaded.
  await page
    .waitForLoadState("networkidle", { timeout: timeoutMs })
    .catch(() => page.waitForLoadState("load", { timeout: timeoutMs }));
}

diagnosticsRouter.get(
  "/search",
  async (req: Request, res: Response, next: NextFunction) => {
    (req.params as { provider?: string }).provider = "diagnostics";
    try {
      const query = SearchQuerySchema.parse(req.query);
      const keyword = query.keyword.trim();
      const timeoutMs = query.timeoutMs ?? env.UPSTREAM_TIMEOUT_MS;

      logger.info(
        { requestId: req.requestId, keyword, timeoutMs },
        "diagnostics: search navigation start",
      );

      const startedAt = Date.now();
      const result = await withContext(async (ctx) => {
        const page = await ctx.newPage();
        await navigateToSearchResults(page, keyword, timeoutMs);
        const currentUrl = page.url();
        const pageTitle = await page.title();
        const resultPageLoaded = RESULTS_URL_PATTERN.test(currentUrl);
        await page.close();
        return { currentUrl, pageTitle, resultPageLoaded };
      });

      const loadTimeMs = Date.now() - startedAt;

      logger.info(
        {
          requestId: req.requestId,
          keyword,
          loadTimeMs,
          result_page_loaded: result.resultPageLoaded,
        },
        "diagnostics: search navigation complete",
      );

      res.status(200).json({
        success: true,
        keyword,
        current_url: result.currentUrl,
        page_title: result.pageTitle,
        result_page_loaded: result.resultPageLoaded,
        load_time_ms: loadTimeMs,
      });
    } catch (err) {
      if (err instanceof HttpError) return next(err);
      return next(mapPlaywrightError(err));
    }
  },
);

// ---------------------------------------------------------------------------
// Phase 4.3 — Search-result extraction diagnostic
// ---------------------------------------------------------------------------

const SearchExtractQuerySchema = SearchQuerySchema.extend({
  limit: z.coerce.number().int().min(1).max(10).optional(),
});

diagnosticsRouter.get(
  "/search-extract",
  async (req: Request, res: Response, next: NextFunction) => {
    (req.params as { provider?: string }).provider = "diagnostics";
    try {
      const query = SearchExtractQuerySchema.parse(req.query);
      const keyword = query.keyword.trim();
      const timeoutMs = query.timeoutMs ?? env.UPSTREAM_TIMEOUT_MS;
      const limit = query.limit ?? 10;

      logger.info(
        { requestId: req.requestId, keyword, timeoutMs, limit },
        "diagnostics: search-extract start",
      );

      const products = await withContext(async (ctx) => {
        const page = await ctx.newPage();
        await navigateToSearchResults(page, keyword, timeoutMs);

        // Lazy-load selectors are isolated in the parser module. Route
        // logic must never contain DOM selectors — see search-results.ts.
        const { extractSearchResults } = await import(
          "../providers/sourcing1688/parsers/search-results.js"
        );
        const rows = await extractSearchResults(page, limit);
        await page.close();
        return rows;
      });

      if (products.length === 0) {
        // No fake data — surface a descriptive error envelope instead.
        return next(
          new HttpError({
            status: 502,
            code: "parse_failed",
            message:
              "No product cards could be extracted from the 1688 results page. The DOM structure may have changed.",
            retryable: false,
          }),
        );
      }

      logger.info(
        { requestId: req.requestId, keyword, count: products.length },
        "diagnostics: search-extract complete",
      );

      res.status(200).json({
        success: true,
        keyword,
        count: products.length,
        products,
      });
    } catch (err) {
      if (err instanceof HttpError) return next(err);
      return next(mapPlaywrightError(err));
    }
  },
);


