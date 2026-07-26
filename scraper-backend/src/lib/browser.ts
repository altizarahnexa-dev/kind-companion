import { chromium, type BrowserContext } from "playwright";
import { existsSync, statSync } from "node:fs";
import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { env } from "../config/env.js";
import { logger } from "./logger.js";

/**
 * Authenticated persistent browsing.
 *
 * We run ONE Chromium `launchPersistentContext` for the whole process. Its
 * `userDataDir` lives on a Docker volume (default `/data/browser-profile`),
 * so cookies survive restarts. On startup we additionally merge any
 * storageState JSON at `AUTH_STATE_PATH` into the context — that's the file
 * the /v1/auth/1688/cookies endpoints export/import so operators can seed a
 * signed-in session.
 *
 * A separate headed persistent context can be opened via
 * `openHeadedLoginContext()` for manual login flows (/v1/admin/session/open).
 * Only one persistent context may bind a given userDataDir at a time, so
 * opening the headed context closes the shared headless one; it is
 * re-created lazily on the next request.
 */

const AUTH_COOKIE_HOSTS = [".1688.com", ".taobao.com", ".alibaba.com"];
const AUTH_COOKIE_NAMES = /^(login_aid|_tb_token_|cookie2|unb|sg|csg|_l_g_|tracknick|_nk_)/i;

let contextPromise: Promise<BrowserContext> | null = null;
let headedContext: BrowserContext | null = null;
let headedOpenedAt: number | null = null;
let lastLoginAt: number | null = null;

export function userDataDir(): string {
  return process.env.USER_DATA_DIR?.trim() || "/data/browser-profile";
}

export function authStatePath(): string {
  return process.env.AUTH_STATE_PATH?.trim() || "/data/1688-state.json";
}

async function launch(headless: boolean): Promise<BrowserContext> {
  const dir = userDataDir();
  await mkdir(dir, { recursive: true });
  const statePath = authStatePath();
  const hasState = existsSync(statePath);

  logger.info(
    { userDataDir: dir, statePath, hasState, headless },
    "launching persistent Chromium context",
  );

  const ctx = await chromium.launchPersistentContext(dir, {
    headless,
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

  return ctx;
}

async function launchShared(): Promise<BrowserContext> {
  const ctx = await launch(env.PLAYWRIGHT_HEADLESS);
  ctx.on("close", () => {
    logger.warn("Playwright persistent context closed");
    contextPromise = null;
  });
  return ctx;
}

/** Lazy singleton. First call launches Chromium; later calls reuse it. */
export function getContext(): Promise<BrowserContext> {
  if (!contextPromise) {
    contextPromise = launchShared().catch((err) => {
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

/** Close the shared headless context if it is running. Idempotent. */
export async function closeSharedContext(): Promise<void> {
  if (!contextPromise) return;
  try {
    const ctx = await contextPromise;
    await ctx.close();
  } catch (err) {
    logger.warn({ err }, "error closing shared context");
  } finally {
    contextPromise = null;
  }
}

/** Graceful shutdown hook — called from server.ts. */
export async function closeBrowser(): Promise<void> {
  await closeSharedContext();
  if (headedContext) {
    try {
      await headedContext.close();
    } catch (err) {
      logger.warn({ err }, "error closing headed context");
    } finally {
      headedContext = null;
      headedOpenedAt = null;
    }
  }
}

/**
 * True when the shared context has at least one cookie that looks like a
 * signed-in session on 1688 / Taobao / Alibaba. Heuristic — good enough
 * for the health endpoint.
 */
export async function isAuthenticated(): Promise<boolean> {
  try {
    const ctx = headedContext ?? (await getContext());
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
  const ctx = headedContext ?? (await getContext());
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
  const ctx = headedContext ?? (await getContext());
  const cookies = state.cookies ?? [];
  if (cookies.length) {
    await ctx.addCookies(cookies);
  }
  const path = authStatePath();
  await mkdir(dirname(path), { recursive: true });
  const merged = await ctx.storageState();
  await writeFile(path, JSON.stringify(merged, null, 2), "utf8");
  lastLoginAt = Date.now();
  return { cookies: cookies.length, path };
}

/**
 * Open a headed persistent context on the same profile and navigate to
 * https://login.1688.com. Starts a background poll that saves cookies to
 * `AUTH_STATE_PATH` once a signed-in session is detected. Returns
 * immediately — the browser stays alive until closed by the operator or by
 * process shutdown.
 */
export async function openHeadedLoginContext(): Promise<{
  alreadyOpen: boolean;
  profileDir: string;
}> {
  const profileDir = userDataDir();
  if (headedContext) {
    return { alreadyOpen: true, profileDir };
  }
  // Only one persistent context per profile — release the shared one first.
  await closeSharedContext();

  const ctx = await launch(false);
  headedContext = ctx;
  headedOpenedAt = Date.now();

  ctx.on("close", () => {
    logger.warn("headed login context closed");
    headedContext = null;
    headedOpenedAt = null;
  });

  const page = ctx.pages()[0] ?? (await ctx.newPage());
  page.goto("https://login.1688.com", { waitUntil: "domcontentloaded" }).catch((err) => {
    logger.warn({ err }, "headed login: initial navigation failed");
  });

  // Poll for a signed-in session and auto-persist cookies once detected.
  const poll = setInterval(async () => {
    if (!headedContext) {
      clearInterval(poll);
      return;
    }
    try {
      const cookies = await headedContext.cookies();
      const signedIn = cookies.some(
        (c) =>
          AUTH_COOKIE_HOSTS.some((h) => c.domain.endsWith(h)) &&
          AUTH_COOKIE_NAMES.test(c.name),
      );
      if (signedIn) {
        const state = await headedContext.storageState();
        const path = authStatePath();
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, JSON.stringify(state, null, 2), "utf8");
        lastLoginAt = Date.now();
        logger.info({ path, cookies: state.cookies.length }, "headed login: cookies persisted");
        clearInterval(poll);
      }
    } catch (err) {
      logger.warn({ err }, "headed login: poll error");
    }
  }, 3_000);

  return { alreadyOpen: false, profileDir };
}

/** Close the headed login context and let the shared headless one relaunch. */
export async function closeHeadedLoginContext(): Promise<{ closed: boolean }> {
  if (!headedContext) return { closed: false };
  try {
    await headedContext.close();
  } catch (err) {
    logger.warn({ err }, "error closing headed login context");
  } finally {
    headedContext = null;
    headedOpenedAt = null;
  }
  return { closed: true };
}

export interface SessionStatus {
  authenticated: boolean;
  lastLogin: string | null;
  profileExists: boolean;
  browserRunning: boolean;
  headedLoginOpen: boolean;
  profileDir: string;
}

export async function getSessionStatus(): Promise<SessionStatus> {
  const profileDir = userDataDir();
  let profileExists = false;
  try {
    const s = statSync(profileDir);
    profileExists = s.isDirectory();
  } catch {
    profileExists = false;
  }

  // If we have never recorded a login in this process, fall back to the
  // mtime of the persisted state file (survives restarts).
  let lastLogin: string | null = lastLoginAt ? new Date(lastLoginAt).toISOString() : null;
  if (!lastLogin) {
    try {
      const s = await stat(authStatePath());
      lastLogin = s.mtime.toISOString();
    } catch {
      /* no state file yet */
    }
  }

  const browserRunning = contextPromise !== null || headedContext !== null;
  const authenticated = browserRunning ? await isAuthenticated() : false;

  return {
    authenticated,
    lastLogin,
    profileExists,
    browserRunning,
    headedLoginOpen: headedContext !== null,
    profileDir,
  };
}

export function headedLoginOpenedAt(): number | null {
  return headedOpenedAt;
}
