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

type PlaywrightStorageState = Awaited<ReturnType<BrowserContext["storageState"]>>;
type PlaywrightCookie = PlaywrightStorageState["cookies"][number];

interface CookieAuditSummary {
  name: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: string;
}

interface CookieComparison {
  uploadedCount: number;
  runtimeCount: number;
  missingCount: number;
  missing: CookieAuditSummary[];
  authCookieNames: string[];
}

export function userDataDir(): string {
  return process.env.USER_DATA_DIR?.trim() || "/data/browser-profile";
}

export function authStatePath(): string {
  return process.env.AUTH_STATE_PATH?.trim() || "/data/1688-state.json";
}

function cookieKey(cookie: Pick<PlaywrightCookie, "name" | "domain" | "path">): string {
  return `${cookie.domain}\t${cookie.path}\t${cookie.name}`;
}

function cookieSummary(cookie: PlaywrightCookie): CookieAuditSummary {
  return {
    name: cookie.name,
    domain: cookie.domain,
    path: cookie.path,
    expires: cookie.expires,
    httpOnly: cookie.httpOnly,
    secure: cookie.secure,
    sameSite: cookie.sameSite,
  };
}

function authCookieNames(cookies: PlaywrightCookie[]): string[] {
  return cookies
    .filter(
      (c) =>
        AUTH_COOKIE_HOSTS.some((h) => c.domain.endsWith(h)) &&
        AUTH_COOKIE_NAMES.test(c.name),
    )
    .map((c) => c.name);
}

function compareCookies(uploaded: PlaywrightCookie[], runtime: PlaywrightCookie[]): CookieComparison {
  const runtimeKeys = new Set(runtime.map(cookieKey));
  const missing = uploaded.filter((cookie) => !runtimeKeys.has(cookieKey(cookie))).map(cookieSummary);
  return {
    uploadedCount: uploaded.length,
    runtimeCount: runtime.length,
    missingCount: missing.length,
    missing,
    authCookieNames: authCookieNames(runtime),
  };
}

function logCookieComparison(phase: string, uploaded: PlaywrightCookie[], runtime: PlaywrightCookie[]) {
  const comparison = compareCookies(uploaded, runtime);
  logger.info(
    {
      phase,
      uploadedCookies: uploaded.map(cookieSummary),
      runtimeCookies: runtime.map(cookieSummary),
      uploadedCount: comparison.uploadedCount,
      runtimeCount: comparison.runtimeCount,
      missingCount: comparison.missingCount,
      missingCookies: comparison.missing,
      authCookies: comparison.authCookieNames,
      possibleDropReasons:
        comparison.runtimeCount < comparison.uploadedCount
          ? [
              "Chromium rejected expired cookies.",
              "Chromium rejected cookies with invalid domain/path attributes.",
              "Chromium normalized or deduplicated cookies with the same domain/path/name.",
            ]
          : [],
    },
    "uploaded cookies vs runtime cookies",
  );
}

async function readPersistedState(path: string): Promise<PlaywrightStorageState | null> {
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as Partial<PlaywrightStorageState>;
    return {
      cookies: parsed.cookies ?? [],
      origins: parsed.origins ?? [],
    };
  } catch (err) {
    logger.warn({ err, statePath: path }, "failed to load storage state file");
    return null;
  }
}

async function addPersistedCookies(ctx: BrowserContext, state: PlaywrightStorageState, phase: string) {
  if (state.cookies.length) {
    await ctx.addCookies(state.cookies);
  }
  const runtime = await ctx.cookies();
  logger.info({ count: state.cookies.length }, "Loaded cookies");
  logCookieComparison(phase, state.cookies, runtime);
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
    const state = await readPersistedState(statePath);
    if (state) {
      await addPersistedCookies(ctx, state, "launchPersistentContext");
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
  const state = await readPersistedState(authStatePath());
  if (state) {
    const runtime = await ctx.cookies();
    logCookieComparison("before_first_navigation", state.cookies, runtime);
  }
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
    return authCookieNames(cookies).length > 0;
  } catch {
    return false;
  }
}

export async function exportStorageState(): Promise<PlaywrightStorageState> {
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
  cookies?: PlaywrightCookie[];
  origins?: unknown[];
}): Promise<{ cookies: number; path: string }> {
  const path = authStatePath();
  await mkdir(dirname(path), { recursive: true });

  // 1. Persist uploaded state to disk FIRST so the next launch seeds from it.
  await writeFile(path, JSON.stringify(state, null, 2), "utf8");
  const incoming = state.cookies ?? [];
  logger.info({ count: incoming.length, path }, "persisted uploaded storage state to disk");

  // 2. Tear down any pre-auth shared context — its in-memory cookie jar
  //    predates the upload. Closing forces a clean relaunch that re-seeds
  //    cookies from AUTH_STATE_PATH via launchHeadless().
  if (contextPromise) {
    logger.info("closing pre-auth shared context so it is recreated with imported cookies");
    await closeSharedContext();
  }

  // 3. Recreate now and re-apply cookies in-memory so the first request
  //    after upload already uses the authenticated session.
  const ctx = await getContext();
  await addPersistedCookies(ctx, { cookies: incoming, origins: [] }, "auth_upload_recreate");
  await ctx.storageState({ path });

  const finalCookies = await ctx.cookies();
  logger.info(
    { loaded: incoming.length, total: finalCookies.length, authCookies: authCookieNames(finalCookies) },
    "browser recreated after auth upload",
  );

  lastLoginAt = Date.now();
  return { cookies: incoming.length, path };
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
