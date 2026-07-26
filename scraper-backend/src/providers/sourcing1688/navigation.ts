import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Page } from "playwright";
import { HttpError } from "../../lib/http-error.js";
import { logger } from "../../lib/logger.js";

const DEBUG_DIR = "/tmp/debug";

async function probePostNavigation(page: Page, phase: string): Promise<void> {
  let url = "";
  let title = "";
  let htmlHead = "";
  let cookies1688: unknown = [];
  let cookiesTaobaoLogin: unknown = [];
  let documentCookie = "";
  let jsState: unknown = null;

  try { url = page.url(); } catch { /* ignore */ }
  try { title = await page.title(); } catch { /* ignore */ }
  try { htmlHead = (await page.content()).slice(0, 5000); } catch { /* ignore */ }
  try { cookies1688 = await page.context().cookies("https://www.1688.com"); } catch { /* ignore */ }
  try { cookiesTaobaoLogin = await page.context().cookies("https://login.taobao.com"); } catch { /* ignore */ }
  try { documentCookie = await page.evaluate(() => document.cookie); } catch { /* ignore */ }
  try {
    jsState = await page.evaluate(() => ({
      location: location.href,
      origin: location.origin,
      hostname: location.hostname,
      readyState: document.readyState,
    }));
  } catch { /* ignore */ }

  logger.warn(
    { phase, url, title, htmlHead, cookies1688, cookiesTaobaoLogin, documentCookie, jsState },
    "nav_probe: post-navigation state",
  );

  if (/login\.(taobao|1688|alibaba)\.com/i.test(url)) {
    try {
      await mkdir(DEBUG_DIR, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const base = join(DEBUG_DIR, `${stamp}_${phase}`);
      try { await page.screenshot({ path: `${base}.png`, fullPage: true }); } catch { /* ignore */ }
      try { await writeFile(`${base}.html`, await page.content(), "utf8"); } catch { /* ignore */ }
      await writeFile(`${base}.url.txt`, url, "utf8");
      logger.warn({ base, url }, "nav_probe: login redirect artifacts saved");
    } catch (err) {
      logger.warn({ err }, "nav_probe: failed to persist debug artifacts");
    }
  }
}

/**
 * Shared 1688 navigation helpers. Route handlers MUST use these — they
 * survive homepage A/B tests and Taobao login redirects that broke the
 * "type into homepage input" flow.
 */

const HOMEPAGE_URL = "https://www.1688.com";
const RESULTS_URL_PATTERN = /(s\.1688\.com|offer_search|\/selloffer\/)/i;
const DETAIL_URL_PATTERN = /detail\.1688\.com\/offer\/(\d+)\.html/i;

const SEARCH_INPUT_SELECTORS = [
  'input[name="keywords"]',
  'input.mod-searchbar-input',
  'input#alisearch-input',
  'input#home-header-searchbox-input',
  'input[placeholder*="搜"]',
  'input[placeholder*="search" i]',
  '#home-header input[type="text"]',
  'form[action*="s.1688.com"] input[type="text"]',
  'textarea[name="keywords"]',
];

function buildDirectSearchUrl(keyword: string, page: number, sort?: string): string {
  const params = new URLSearchParams({ keywords: keyword });
  if (page > 1) params.set("beginPage", String(page));
  if (sort === "price_asc") params.set("sortType", "price_asc");
  else if (sort === "price_desc") params.set("sortType", "price_desc");
  else if (sort === "sales_desc" || sort === "sales") params.set("sortType", "va_rts_desc");
  else if (sort === "newest") params.set("sortType", "newest");
  return `https://s.1688.com/selloffer/offer_search.htm?${params.toString()}`;
}

export function buildProductDetailUrl(externalId: string): string {
  return `https://detail.1688.com/offer/${encodeURIComponent(externalId)}.html`;
}

export { RESULTS_URL_PATTERN, DETAIL_URL_PATTERN };

/**
 * Navigate to a 1688 search results page. Prefers a direct URL, falls
 * back to submitting the homepage form. Throws HttpError(502) when the
 * page never reaches a recognizable results URL.
 */
export async function navigateToSearchResults(
  page: Page,
  keyword: string,
  opts: { pageNum?: number; sort?: string; timeoutMs: number },
): Promise<void> {
  const { pageNum = 1, sort, timeoutMs } = opts;
  const directUrl = buildDirectSearchUrl(keyword, pageNum, sort);

  // Path A — direct
  try {
    await page.goto(directUrl, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    await probePostNavigation(page, "search_direct");
    await page.waitForURL(RESULTS_URL_PATTERN, { timeout: 8_000 }).catch(() => {});
    if (RESULTS_URL_PATTERN.test(page.url())) {
      await page
        .waitForLoadState("networkidle", { timeout: timeoutMs })
        .catch(() => page.waitForLoadState("load", { timeout: timeoutMs }).catch(() => {}));
      return;
    }
  } catch {
    /* fall through */
  }

  // Path B — homepage form
  await page.goto(HOMEPAGE_URL, { waitUntil: "domcontentloaded", timeout: timeoutMs });
  let filled = false;
  for (const selector of SEARCH_INPUT_SELECTORS) {
    const input = page.locator(selector).first();
    try {
      await input.waitFor({ state: "visible", timeout: 2_500 });
      await input.fill(keyword);
      filled = true;
      break;
    } catch {
      /* try next */
    }
  }
  if (!filled) {
    await page.goto(directUrl, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    if (!RESULTS_URL_PATTERN.test(page.url())) {
      throw new HttpError({
        status: 502,
        code: "upstream_unavailable",
        message:
          "Search input not found and direct search URL was redirected. Selectors may be stale or 1688 is showing a login wall.",
        retryable: true,
        details: { finalUrl: page.url() },
      });
    }
    await page
      .waitForLoadState("networkidle", { timeout: timeoutMs })
      .catch(() => page.waitForLoadState("load", { timeout: timeoutMs }).catch(() => {}));
    return;
  }

  await Promise.all([
    page.waitForURL(RESULTS_URL_PATTERN, { timeout: timeoutMs }),
    page.keyboard.press("Enter"),
  ]);
  await page
    .waitForLoadState("networkidle", { timeout: timeoutMs })
    .catch(() => page.waitForLoadState("load", { timeout: timeoutMs }).catch(() => {}));
}

/**
 * Navigate to a product detail page. Throws HttpError(404) if the page
 * clearly indicates the offer no longer exists.
 */
export async function navigateToProductDetail(
  page: Page,
  externalId: string,
  timeoutMs: number,
): Promise<void> {
  const url = buildProductDetailUrl(externalId);
  const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
  const status = response?.status() ?? 0;
  if (status === 404) {
    throw new HttpError({
      status: 404,
      code: "not_found",
      message: "Product not found.",
      retryable: false,
    });
  }
  await page
    .waitForLoadState("networkidle", { timeout: timeoutMs })
    .catch(() => page.waitForLoadState("load", { timeout: timeoutMs }).catch(() => {}));
  // 1688 sometimes serves a "offer removed" HTML at 200 status.
  const finalUrl = page.url();
  if (!DETAIL_URL_PATTERN.test(finalUrl) && !/detail\.1688\.com/.test(finalUrl)) {
    throw new HttpError({
      status: 404,
      code: "not_found",
      message: "Product not found (redirected away from detail host).",
      retryable: false,
      details: { finalUrl },
    });
  }
}

/**
 * Try to extract a price display string like "¥45.99" or "45.99-62.99"
 * into { amountMinor, currency, display }. Returns null when parsing
 * fails. Currency is CNY by default — 1688 is a domestic Chinese
 * marketplace and native prices are always yuan.
 */
export function parseYuanPrice(display: string | null | undefined): {
  amountMinor: number;
  currency: "CNY";
  display: string;
} | null {
  if (!display) return null;
  const cleaned = display.replace(/[¥￥\s元人民币CNY]/gi, "").trim();
  if (!cleaned) return null;
  // Take the FIRST number in the string (range "10.5-20.0" → 10.5).
  const match = cleaned.match(/(\d+(?:[.,]\d+)?)/);
  if (!match) return null;
  const asNumber = Number.parseFloat(match[1]!.replace(",", "."));
  if (!Number.isFinite(asNumber) || asNumber < 0) return null;
  return {
    amountMinor: Math.round(asNumber * 100),
    currency: "CNY",
    display: display.trim(),
  };
}

/**
 * Parse a range display like "¥10.00-20.00" into { minMinor, maxMinor }.
 * Returns null when only a single number is present.
 */
export function parseYuanPriceRange(display: string | null | undefined): {
  minMinor: number;
  maxMinor: number;
  currency: "CNY";
} | null {
  if (!display) return null;
  const nums = Array.from(display.matchAll(/(\d+(?:[.,]\d+)?)/g)).map((m) =>
    Number.parseFloat(m[1]!.replace(",", ".")),
  );
  if (nums.length < 2) return null;
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  if (!Number.isFinite(min) || !Number.isFinite(max) || min < 0 || max < min) return null;
  return {
    minMinor: Math.round(min * 100),
    maxMinor: Math.round(max * 100),
    currency: "CNY",
  };
}
