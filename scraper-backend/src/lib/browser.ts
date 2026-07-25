import { chromium, type Browser, type BrowserContext, type LaunchOptions } from "playwright";
import { env } from "../config/env.js";
import { logger } from "./logger.js";

/**
 * Browser singleton. One Chromium instance is shared across requests; each
 * request gets its own isolated BrowserContext (cookies, storage) via
 * `withContext()`. This is the standard pattern for a Playwright server —
 * launching per request would cost 500ms+ every call.
 *
 * Phase 4.1: infrastructure only. Higher-level scraping code will call
 * `withContext()` in later phases.
 */

let browserPromise: Promise<Browser> | null = null;

function buildLaunchOptions(): LaunchOptions {
  const opts: LaunchOptions = {
    headless: env.PLAYWRIGHT_HEADLESS,
    // These flags are the canonical set for running Chromium inside a
    // constrained Linux container. Without them Chromium refuses to start
    // as an unprivileged user in Docker.
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
    ],
  };
  if (env.PLAYWRIGHT_PROXY_URL) {
    opts.proxy = { server: env.PLAYWRIGHT_PROXY_URL };
  }
  return opts;
}

async function launch(): Promise<Browser> {
  logger.info(
    { headless: env.PLAYWRIGHT_HEADLESS, browser: env.PLAYWRIGHT_BROWSER },
    "launching Playwright browser",
  );
  const browser = await chromium.launch(buildLaunchOptions());
  browser.on("disconnected", () => {
    logger.warn("Playwright browser disconnected");
    browserPromise = null;
  });
  return browser;
}

/**
 * Lazy singleton. First call launches Chromium; subsequent calls reuse it.
 * If the browser has disconnected, the next call re-launches.
 */
export function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = launch().catch((err) => {
      browserPromise = null;
      throw err;
    });
  }
  return browserPromise;
}

/**
 * Run `fn` inside a fresh isolated BrowserContext. The context is always
 * closed, even on error. Callers get automatic isolation between requests.
 */
export async function withContext<T>(
  fn: (ctx: BrowserContext) => Promise<T>,
  contextOptions?: Parameters<Browser["newContext"]>[0],
): Promise<T> {
  const browser = await getBrowser();
  const ctx = await browser.newContext({
    viewport: { width: 1366, height: 900 },
    locale: "en-US",
    userAgent:
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    ...contextOptions,
  });
  try {
    return await fn(ctx);
  } finally {
    await ctx.close().catch(() => {});
  }
}

/** Graceful shutdown hook — called from server.ts. */
export async function closeBrowser(): Promise<void> {
  if (!browserPromise) return;
  try {
    const browser = await browserPromise;
    await browser.close();
    logger.info("Playwright browser closed");
  } catch (err) {
    logger.warn({ err }, "error closing Playwright browser");
  } finally {
    browserPromise = null;
  }
}
