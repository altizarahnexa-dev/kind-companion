import { chromium, type BrowserContext } from "playwright";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { env } from "../config/env.js";
import { logger } from "./logger.js";

/**
 * Authenticated persistent browsing.
 *
 * We run ONE Chromium `launchPersistentContext` for the whole process. Its
 * `userDataDir` lives on a Docker volume, so cookies survive restarts. On
 * startup we additionally merge any storageState JSON at `AUTH_STATE_PATH`
 * into the context — that's the file the /v1/auth/1688/cookies endpoints
 * export/import so operators can seed a signed-in session.
 *
 * Each request calls `withContext(fn)` and opens its own `page` from the
 * shared context. Cookies are intentionally shared across requests — that
 * is the whole point of persistent auth.
 */

const AUTH_COOKIE_HOSTS = [".1688.com", ".taobao.com", ".alibaba.com"];
const AUTH_COOKIE_NAMES = /^(login_aid|_tb_token_|cookie2|unb|sg|csg|_l_g_|tracknick|_nk_)/i;

let contextPromise: Promise<BrowserContext> | null = null;

export function userDataDir(): string {
  return process.env.USER_DATA_DIR?.trim() || "/data/userdata";
}

export function authStatePath(): string {
  return process.env.AUTH_STATE_PATH?.trim() || "/data/1688-state.json";
}

async function launch(): Promise<BrowserContext> {
  const dir = userDataDir();
  await mkdir(dir, { recursive: true });
  const statePath = authStatePath();
  const hasState = existsSync(statePath);

  logger.info(
    { userDataDir: dir, statePath, hasState, headless: env.PLAYWRIGHT_HEADLESS },
    "launching persistent Chromium context",
  );

  const ctx = await chromium.launchPersistentContext(dir, {
    headless: env.PLAYWRIGHT_HEADLESS,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
    ],
    viewport: { width: 1366, height: 900 },
    locale: "en-US",
    userAgent:
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    proxy: env.PLAYWRIGHT_PROXY_URL ? { server: env.PLAYWRIGHT_PROXY_URL } : undefined,
  });

  // Seed cookies from disk (in addition to userDataDir persistence).
  if (hasState) {
    try {
      const raw = await readFile(statePath, "utf8");
      const parsed = JSON.parse(raw) as {
        cookies?: Parameters<BrowserContext["addCookies"]>[0];
      };
      if (parsed.cookies?.length) {
        await ctx.addCookies(parsed.cookies);
        logger.info({ count: parsed.cookies.length }, "loaded cookies from state file");
      }
    } catch (err) {
      logger.warn({ err, statePath }, "failed to load storage state file");
    }
  }

  ctx.on("close", () => {
    logger.warn("Playwright persistent context closed");
    contextPromise = null;
  });

  return ctx;
}

/** Lazy singleton. First call launches Chromium; later calls reuse it. */
export function getContext(): Promise<BrowserContext> {
  if (!contextPromise) {
    contextPromise = launch().catch((err) => {
      contextPromise = null;
      throw err;
    });
  }
  return contextPromise;
}

/**
 * Run `fn` with the shared persistent context. Each caller opens its own
 * `page` and closes it — the context itself is long-lived.
 */
export async function withContext<T>(
  fn: (ctx: BrowserContext) => Promise<T>,
): Promise<T> {
  const ctx = await getContext();
  return fn(ctx);
}

/** Graceful shutdown hook — called from server.ts. */
export async function closeBrowser(): Promise<void> {
  if (!contextPromise) return;
  try {
    const ctx = await contextPromise;
    await ctx.close();
    logger.info("Playwright persistent context closed");
  } catch (err) {
    logger.warn({ err }, "error closing Playwright context");
  } finally {
    contextPromise = null;
  }
}

/**
 * True when the shared context has at least one cookie that looks like a
 * signed-in session on 1688 / Taobao / Alibaba. Heuristic — good enough
 * for the health endpoint.
 */
export async function isAuthenticated(): Promise<boolean> {
  try {
    const ctx = await getContext();
    const cookies = await ctx.cookies();
    return cookies.some(
      (c) =>
        AUTH_COOKIE_HOSTS.some((h) => c.domain.endsWith(h)) &&
        AUTH_COOKIE_NAMES.test(c.name),
    );
  } catch {
    return false;
  }
}

export async function exportStorageState(): Promise<Awaited<
  ReturnType<BrowserContext["storageState"]>
>> {
  const ctx = await getContext();
  return ctx.storageState();
}

/**
 * Import a storageState-shaped JSON blob into the running context and
 * persist it to `AUTH_STATE_PATH` for the next restart. Returns the count
 * of cookies applied.
 */
export async function importStorageState(state: {
  cookies?: Parameters<BrowserContext["addCookies"]>[0];
  origins?: unknown[];
}): Promise<{ cookies: number; path: string }> {
  const ctx = await getContext();
  const cookies = state.cookies ?? [];
  if (cookies.length) {
    await ctx.addCookies(cookies);
  }
  const path = authStatePath();
  await mkdir(dirname(path), { recursive: true });
  const merged = await ctx.storageState();
  await writeFile(path, JSON.stringify(merged, null, 2), "utf8");
  return { cookies: cookies.length, path };
}
