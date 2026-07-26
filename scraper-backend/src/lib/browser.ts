import { chromium, type BrowserContext } from "playwright";
import { existsSync, statSync } from "node:fs";
import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { env } from "../config/env.js";
import { logger } from "./logger.js";

/**
 * Authenticated persistent browsing — HEADLESS ONLY.
 *
 * The VPS never launches a headed browser (no X server, by design).
 * Operators run `scripts/local-login.mjs` on their workstation to log in
 * manually against 1688, export a Playwright storageState JSON, and POST
 * it to `/v1/auth/1688/cookies`. That endpoint calls `importStorageState`
 * below, which:
 *   1. Adds the cookies to the running shared context.
 *   2. Persists the storageState to `AUTH_STATE_PATH` on the mounted
 *      volume so it survives restarts.
 *
 * On every context launch we seed cookies from `AUTH_STATE_PATH` in
 * addition to the persistent `userDataDir`. If auth expires, the caller
 * gets HTTP 401 `authentication_required`; the VPS never tries to
 * self-heal by opening a headed window.
 */

const AUTH_COOKIE_HOSTS = [".1688.com", ".taobao.com", ".alibaba.com"];
const AUTH_COOKIE_NAMES = /^(login_aid|_tb_token_|cookie2|unb|sg|csg|_l_g_|tracknick|_nk_)/i;

let contextPromise: Promise<BrowserContext> | null = null;
let lastLoginAt: number | null = null;

export function userDataDir(): string {
  return process.env.USER_DATA_DIR?.trim() || "/data/browser-profile";
}

export function authStatePath(): string {
  return process.env.AUTH_STATE_PATH?.trim() || "/data/1688-state.json";
}

async function launchHeadless(): Promise<BrowserContext> {
  const dir = userDataDir();
  await mkdir(dir, { recursive: true });
  const statePath = authStatePath();
  const hasState = existsSync(statePath);

  logger.info(
    { userDataDir: dir, statePath, hasState },
    "launching persistent headless Chromium context",
  );

  const ctx = await chromium.launchPersistentContext(dir, {
    headless: true,
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
  const ctx = await launchHeadless();
  ctx.on("close", () => {
    logger.warn("Playwright persistent context closed");
    contextPromise = null;
  });
  return ctx;
}

export function getContext(): Promise<BrowserContext> {
  if (!contextPromise) {
    contextPromise = launchShared().catch((err) => {
      contextPromise = null;
      throw err;
    });
  }
  return contextPromise;
}

export async function withContext<T>(
  fn: (ctx: BrowserContext) => Promise<T>,
): Promise<T> {
  const ctx = await getContext();
  return fn(ctx);
}

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

export async function closeBrowser(): Promise<void> {
  await closeSharedContext();
}

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
 * Import a Playwright storageState JSON produced by the local login
 * utility. Cookies are applied to the running headless context and the
 * merged state is persisted to `AUTH_STATE_PATH` so it survives
 * restarts. Returns the number of cookies applied.
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
  lastLoginAt = Date.now();
  return { cookies: cookies.length, path };
}

export interface SessionStatus {
  authenticated: boolean;
  lastLogin: string | null;
  profileExists: boolean;
  browserRunning: boolean;
  headedLoginOpen: false;
  profileDir: string;
  statePath: string;
  stateExists: boolean;
}

export async function getSessionStatus(): Promise<SessionStatus> {
  const profileDir = userDataDir();
  let profileExists = false;
  try {
    profileExists = statSync(profileDir).isDirectory();
  } catch {
    profileExists = false;
  }

  const statePath = authStatePath();
  let lastLogin: string | null = lastLoginAt ? new Date(lastLoginAt).toISOString() : null;
  let stateExists = false;
  try {
    const s = await stat(statePath);
    stateExists = true;
    if (!lastLogin) lastLogin = s.mtime.toISOString();
  } catch {
    /* no state file yet */
  }

  const browserRunning = contextPromise !== null;
  const authenticated = browserRunning ? await isAuthenticated() : stateExists;

  return {
    authenticated,
    lastLogin,
    profileExists,
    browserRunning,
    headedLoginOpen: false,
    profileDir,
    statePath,
    stateExists,
  };
}
