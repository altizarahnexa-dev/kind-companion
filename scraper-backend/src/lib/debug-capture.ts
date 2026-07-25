import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Page } from "playwright";
import { logger } from "./logger.js";

/**
 * Debug capture for parse failures. Persists a full-page screenshot and the
 * raw HTML to disk, plus logs signals that indicate why parsing failed
 * (login wall, captcha, robot check). Returns the file paths so the caller
 * can attach them to the error envelope.
 *
 * Storage: DEBUG_DIR env var, falling back to /tmp/scraper-debug. The
 * directory is created on demand; nothing else on the host is touched.
 */

const BLOCKING_PHRASES: readonly string[] = [
  "验证码",
  "滑动验证",
  "登录",
  "Please login",
  "Access denied",
  "Robot",
];

export interface ParseDebugCapture {
  url: string;
  title: string;
  screenshot: string;
  html: string;
  signals: {
    hasPasswordInput: boolean;
    matchedPhrases: string[];
  };
}

function debugRoot(): string {
  return process.env.DEBUG_DIR?.trim() || "/tmp/scraper-debug";
}

function slug(input: string): string {
  return input.replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 40) || "capture";
}

export async function captureParseFailure(
  page: Page,
  opts: { requestId: string; phase: string; label?: string },
): Promise<ParseDebugCapture> {
  const root = debugRoot();
  await mkdir(root, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const base = `${stamp}_${slug(opts.phase)}_${slug(opts.label ?? "")}_${slug(opts.requestId)}`;
  const screenshotPath = join(root, `${base}.png`);
  const htmlPath = join(root, `${base}.html`);

  let url = "";
  let title = "";
  let hasPasswordInput = false;
  let matchedPhrases: string[] = [];

  try {
    url = page.url();
  } catch {
    /* page may be closed */
  }
  try {
    title = await page.title();
  } catch {
    /* ignore */
  }

  try {
    hasPasswordInput = await page.evaluate(
      () => !!document.querySelector("input[type=password]"),
    );
  } catch {
    /* ignore */
  }

  try {
    const bodyText: string = await page.evaluate(
      () => document.body?.innerText ?? "",
    );
    matchedPhrases = BLOCKING_PHRASES.filter((p) =>
      bodyText.toLowerCase().includes(p.toLowerCase()),
    );
  } catch {
    /* ignore */
  }

  try {
    await page.screenshot({ path: screenshotPath, fullPage: true });
  } catch (err) {
    logger.warn({ err, screenshotPath }, "debug capture: screenshot failed");
  }

  try {
    const html = await page.content();
    await writeFile(htmlPath, html, "utf8");
  } catch (err) {
    logger.warn({ err, htmlPath }, "debug capture: html write failed");
  }

  logger.warn(
    {
      requestId: opts.requestId,
      phase: opts.phase,
      url,
      title,
      screenshot: screenshotPath,
      html: htmlPath,
      hasPasswordInput,
      matchedPhrases,
    },
    "parse_failed: debug capture saved",
  );

  return {
    url,
    title,
    screenshot: screenshotPath,
    html: htmlPath,
    signals: { hasPasswordInput, matchedPhrases },
  };
}
