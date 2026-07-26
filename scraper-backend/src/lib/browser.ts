import { chromium, type BrowserContext, type Cookie, type Page } from "playwright";
import { statSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { env } from "../config/env.js";
import { logger } from "./logger.js";

/**
 * Authenticated persistent browsing — HEADLESS ONLY.
 *
 * The VPS never opens a headed browser. Operators authenticate locally,
 * upload a Playwright storageState JSON to `/v1/auth/1688/cookies`, and this
 * module explicitly hydrates that state into the runtime Chromium context.
 *
 * Important: the lifecycle below intentionally does not trust the persistent
 * profile or storageState file to hydrate auth automatically. Every launch
 * reads `AUTH_STATE_PATH`, calls `context.addCookies(...)`, restores origin
 * storage with a temporary page, reloads once, verifies cookies, and only then
 * exposes the singleton to routes.
 */

const AUTH_COOKIE_HOSTS = [".1688.com", ".taobao.com", ".alibaba.com"];
const AUTH_COOKIE_NAMES = /^(login_aid|unb|sgcookie|_l_g_|tracknick|_nk_|lgc|cookie17|dnk|skt|uc1|uc3)$/i;
const HYDRATION_CHECK_URL = "https://www.1688.com";
const HYDRATION_TIMEOUT_MS = 45_000;

let contextPromise: Promise<BrowserContext> | null = null;
let lastLoginAt: number | null = null;

type NativeStorageState = Awaited<ReturnType<BrowserContext["storageState"]>>;
type PlaywrightCookie = NativeStorageState["cookies"][number];
type NativeOrigin = NativeStorageState["origins"][number];
type StorageItem = { name: string; value: string };

interface PersistedOrigin extends NativeOrigin {
  sessionStorage?: StorageItem[];
}

interface PersistedStorageState {
  cookies: PlaywrightCookie[];
  origins: PersistedOrigin[];
}

export function userDataDir(): string {
  return process.env.USER_DATA_DIR?.trim() || "/data/browser-profile";
}

export function authStatePath(): string {
  return process.env.AUTH_STATE_PATH?.trim() || "/data/1688-state.json";
}

function authCookieNames(cookies: Cookie[]): string[] {
  return cookies
    .filter(
      (cookie) =>
        AUTH_COOKIE_HOSTS.some((host) => cookie.domain.endsWith(host)) &&
        AUTH_COOKIE_NAMES.test(cookie.name),
    )
    .map((cookie) => cookie.name);
}

function normalizeStorageItems(value: unknown): StorageItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (
      item &&
      typeof item === "object" &&
      "name" in item &&
      "value" in item &&
      typeof item.name === "string" &&
      typeof item.value === "string"
    ) {
      return [{ name: item.name, value: item.value }];
    }
    return [];
  });
}

function normalizeOrigins(value: unknown): PersistedOrigin[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((origin) => {
    if (
      origin &&
      typeof origin === "object" &&
      "origin" in origin &&
      typeof origin.origin === "string"
    ) {
      const localStorage = "localStorage" in origin ? normalizeStorageItems(origin.localStorage) : [];
      const sessionStorage = "sessionStorage" in origin ? normalizeStorageItems(origin.sessionStorage) : [];
      return [{ origin: origin.origin, localStorage, sessionStorage }];
    }
    return [];
  });
}

function normalizeStorageState(state: {
  cookies?: PlaywrightCookie[];
  origins?: unknown[];
}): PersistedStorageState {
  return {
    cookies: Array.isArray(state.cookies) ? state.cookies : [],
    origins: normalizeOrigins(state.origins),
  };
}

async function stateFileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function readPersistedState(path: string): Promise<PersistedStorageState | null> {
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as { cookies?: PlaywrightCookie[]; origins?: unknown[] };
    return normalizeStorageState(parsed);
  } catch (err) {
    logger.warn({ err, statePath: path }, "failed to load persisted 1688 storage state");
    return null;
  }
}

async function addCookiesExplicitly(ctx: BrowserContext, cookies: PlaywrightCookie[]): Promise<void> {
  if (cookies.length === 0) return;

  try {
    await ctx.addCookies(cookies);
    return;
  } catch (err) {
    logger.warn({ err, uploadedCookieCount: cookies.length }, "bulk cookie hydration failed; retrying individually");
  }

  let hydrated = 0;
  for (const cookie of cookies) {
    try {
      await ctx.addCookies([cookie]);
      hydrated += 1;
    } catch (err) {
      logger.warn(
        {
          err,
          cookieName: cookie.name,
          domain: cookie.domain,
          path: cookie.path,
          expires: cookie.expires,
        },
        "single cookie hydration failed",
      );
    }
  }

  logger.info({ uploadedCookieCount: cookies.length, hydratedCookieCount: hydrated }, "cookie hydration retry complete");
}

async function gotoForHydration(page: Page, url: string): Promise<boolean> {
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: HYDRATION_TIMEOUT_MS });
    return true;
  } catch (err) {
    logger.warn({ err, url }, "temporary hydration page navigation failed");
    return false;
  }
}

async function restoreOriginStorage(page: Page, origin: PersistedOrigin): Promise<void> {
  const targetUrl = origin.origin.endsWith("/") ? origin.origin : `${origin.origin}/`;
  const reached = await gotoForHydration(page, targetUrl);
  if (!reached) return;

  const activeOrigin = await page.evaluate(() => window.location.origin).catch(() => null);
  if (activeOrigin !== origin.origin) {
    logger.warn(
      { expectedOrigin: origin.origin, activeOrigin, finalUrl: page.url() },
      "skipped origin storage restore because navigation landed on a different origin",
    );
    return;
  }

  await page.evaluate(
    ({ localStorageItems, sessionStorageItems }) => {
      for (const item of localStorageItems) {
        window.localStorage.setItem(item.name, item.value);
      }
      for (const item of sessionStorageItems) {
        window.sessionStorage.setItem(item.name, item.value);
      }
    },
    {
      localStorageItems: origin.localStorage,
      sessionStorageItems: origin.sessionStorage ?? [],
    },
  );
}

async function reloadHydrationPage(page: Page): Promise<void> {
  try {
    await page.reload({ waitUntil: "domcontentloaded", timeout: HYDRATION_TIMEOUT_MS });
  } catch (err) {
    logger.warn({ err, finalUrl: page.url() }, "temporary hydration page reload failed");
  }
}

async function runtimeHydrationSnapshot(ctx: BrowserContext, page: Page) {
  const runtimeCookies = await ctx.cookies();
  const documentCookie = await page.evaluate(() => document.cookie).catch(() => "");
  const locationHostname = await page.evaluate(() => window.location.hostname).catch(() => "");

  return {
    runtimeCookieCount: runtimeCookies.length,
    authCookieNames: authCookieNames(runtimeCookies),
    documentCookie,
    locationHostname,
  };
}

async function hydrateRuntimeState(ctx: BrowserContext, state: PersistedStorageState | null): Promise<void> {
  const page = await ctx.newPage();

  try {
    if (state) {
      await addCookiesExplicitly(ctx, state.cookies);

      for (const origin of state.origins) {
        await restoreOriginStorage(page, origin);
      }
    }

    if (page.url() === "about:blank") {
      await gotoForHydration(page, HYDRATION_CHECK_URL);
    }

    await reloadHydrationPage(page);

    const snapshot = await runtimeHydrationSnapshot(ctx, page);
    if (state && state.cookies.length > 0 && snapshot.runtimeCookieCount === 0) {
      throw new Error("Runtime hydration failed: no cookies exist after context.addCookies().");
    }

    logger.info(snapshot, "Playwright runtime state hydrated before singleton exposure");
  } finally {
    await page.close().catch((err) => {
      logger.warn({ err }, "failed to close temporary hydration page");
    });
  }
}

async function launchPersistentContext(): Promise<BrowserContext> {
  const dir = userDataDir();
  const statePath = authStatePath();
  await mkdir(dir, { recursive: true });

  const hasState = await stateFileExists(statePath);
  const persistedState = hasState ? await readPersistedState(statePath) : null;

  logger.info(
    {
      userDataDir: dir,
      statePath,
      hasState,
      uploadedCookieCount: persistedState?.cookies.length ?? 0,
      uploadedOriginCount: persistedState?.origins.length ?? 0,
    },
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

  try {
    await hydrateRuntimeState(ctx, persistedState);
    return ctx;
  } catch (err) {
    await ctx.close().catch((closeErr) => {
      logger.warn({ err: closeErr }, "failed to close context after hydration failure");
    });
    throw err;
  }
}

async function launchShared(): Promise<BrowserContext> {
  const ctx = await launchPersistentContext();
  ctx.on("close", () => {
    logger.warn("Playwright persistent context closed");
    contextPromise = null;
  });
  return ctx;
}

export async function getContext(): Promise<BrowserContext> {
  if (!contextPromise) {
    contextPromise = launchShared().catch((err) => {
      contextPromise = null;
      throw err;
    });
  }
  return contextPromise;
}

export async function withContext<T>(fn: (ctx: BrowserContext) => Promise<T>): Promise<T> {
  const ctx = await getContext();
  return fn(ctx);
}

export async function closeSharedContext(): Promise<void> {
  if (!contextPromise) return;
  try {
    const ctx = await contextPromise;
    await ctx.close();
  } catch (err) {
    logger.warn({ err }, "error closing shared Playwright context");
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

export async function exportStorageState(): Promise<NativeStorageState> {
  const ctx = await getContext();
  return ctx.storageState();
}

/**
 * Import a Playwright storageState JSON produced by the local login utility.
 * The uploaded state is persisted, the existing singleton is destroyed, and a
 * fresh singleton is launched only after explicit runtime hydration succeeds.
 */
export async function importStorageState(state: {
  cookies?: PlaywrightCookie[];
  origins?: unknown[];
}): Promise<{ cookies: number; path: string }> {
  const path = authStatePath();
  await mkdir(dirname(path), { recursive: true });

  const uploadedState = normalizeStorageState(state);
  await writeFile(path, JSON.stringify(uploadedState, null, 2), "utf8");

  logger.info(
    {
      path,
      uploadedCookieCount: uploadedState.cookies.length,
      uploadedOriginCount: uploadedState.origins.length,
      hadExistingSingleton: contextPromise !== null,
    },
    "persisted uploaded 1688 storage state",
  );

  await closeSharedContext();
  await getContext();

  lastLoginAt = Date.now();
  return { cookies: uploadedState.cookies.length, path };
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
    const stateStats = await stat(statePath);
    stateExists = true;
    if (!lastLogin) lastLogin = stateStats.mtime.toISOString();
  } catch {
    // No uploaded state file yet.
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
