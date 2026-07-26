import { chromium, type BrowserContext, type Page } from "playwright";
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
// Strong signed-in cookies only. Do not include weak anonymous/session
// scaffolding such as `_tb_token_`, `cookie2`, `sg`, or `csg`: those can be
// present before login and caused health/status to report false positives.
const AUTH_COOKIE_NAMES = /^(login_aid|unb|sgcookie|_l_g_|tracknick|_nk_|lgc|cookie17|dnk|skt|uc1|uc3)$/i;
const NAVIGATION_COOKIE_URLS = [
  "https://www.1688.com",
  "https://s.1688.com",
  "https://detail.1688.com",
  "https://login.1688.com",
  "https://login.taobao.com",
];
const COOKIE_AUDIT_URLS = [
  "https://www.1688.com",
  "https://login.1688.com",
  "https://login.taobao.com",
];

let contextPromise: Promise<BrowserContext> | null = null;
let lastLoginAt: number | null = null;
let nextContextId = 1;

const contextIds = new WeakMap<BrowserContext, number>();
const instrumentedContexts = new WeakSet<BrowserContext>();
const instrumentedPages = new WeakSet<Page>();

type PlaywrightStorageState = Awaited<ReturnType<BrowserContext["storageState"]>>;
type PlaywrightCookie = PlaywrightStorageState["cookies"][number];
type PlaywrightOrigin = PlaywrightStorageState["origins"][number];

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

interface CookieAuditSnapshot {
  url: string;
  count: number;
  authenticatedCookieCount: number;
  authCookieNames: string[];
  cookies: CookieAuditSummary[];
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

function contextId(ctx: BrowserContext): number {
  const existing = contextIds.get(ctx);
  if (existing) return existing;
  const id = nextContextId;
  nextContextId += 1;
  contextIds.set(ctx, id);
  return id;
}

function storageStateSummary(state: PlaywrightStorageState) {
  return {
    cookieCount: state.cookies.length,
    authenticatedCookieCount: authCookieNames(state.cookies).length,
    authCookieNames: authCookieNames(state.cookies),
    originsCount: state.origins.length,
    origins: state.origins.map(originSummary),
  };
}

function originSummary(origin: PlaywrightOrigin) {
  return {
    origin: origin.origin,
    localStorageCount: origin.localStorage.length,
    localStorageKeys: origin.localStorage.map((item) => item.name),
  };
}

function normalizeStorageState(state: {
  cookies?: PlaywrightCookie[];
  origins?: unknown[];
}): PlaywrightStorageState {
  return {
    cookies: state.cookies ?? [],
    origins: (state.origins ?? []) as PlaywrightOrigin[],
  };
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

async function cookieSnapshots(ctx: BrowserContext, urls = COOKIE_AUDIT_URLS): Promise<CookieAuditSnapshot[]> {
  const snapshots: CookieAuditSnapshot[] = [];
  for (const url of urls) {
    const cookies = await ctx.cookies(url);
    const names = authCookieNames(cookies);
    snapshots.push({
      url,
      count: cookies.length,
      authenticatedCookieCount: names.length,
      authCookieNames: names,
      cookies: cookies.map(cookieSummary),
    });
  }
  return snapshots;
}

async function auditLiveContext(
  phase: string,
  ctx: BrowserContext,
  uploadedState?: PlaywrightStorageState | null,
): Promise<void> {
  try {
    const runtime = await ctx.cookies();
    const runtimeState = await ctx.storageState();
    const snapshots = await cookieSnapshots(ctx);
    const uploaded = uploadedState?.cookies ?? [];

    logger.info(
      {
        phase,
        contextId: contextId(ctx),
        liveCookieCount: runtime.length,
        liveAuthenticatedCookieCount: authCookieNames(runtime).length,
        liveAuthCookieNames: authCookieNames(runtime),
        cookieApplicability: snapshots,
        uploadedStorageState: uploadedState ? storageStateSummary(uploadedState) : null,
        liveStorageState: storageStateSummary(runtimeState),
        originsRestored:
          uploadedState && uploadedState.origins.length > 0
            ? uploadedState.origins.every((origin) =>
                runtimeState.origins.some((liveOrigin) => liveOrigin.origin === origin.origin),
              )
            : null,
      },
      "Playwright live context cookie/origin audit",
    );

    if (uploadedState) {
      logCookieComparison(phase, uploaded, runtime);
    }
  } catch (err) {
    logger.warn({ err, phase }, "failed to audit Playwright live context");
  }
}

async function auditExistingSingletonBeforeUpload(uploadedState: PlaywrightStorageState): Promise<void> {
  if (!contextPromise) {
    logger.info(
      { phase: "auth_upload_before_upload", uploadedStorageState: storageStateSummary(uploadedState) },
      "no live Playwright singleton existed before auth upload",
    );
    return;
  }

  try {
    const ctx = await contextPromise;
    await auditLiveContext("auth_upload_before_upload_existing_singleton", ctx, uploadedState);
  } catch (err) {
    logger.warn({ err }, "failed to inspect existing singleton before auth upload");
  }
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
  logger.info(
    {
      phase,
      contextId: contextId(ctx),
      importedStorageState: storageStateSummary(state),
      originRestoreMode: "not_applied_by_addCookies",
      note: "BrowserContext.addCookies only imports cookies; Playwright origins/localStorage are not restored by this helper.",
    },
    "adding persisted cookies to Playwright context",
  );
  if (state.cookies.length) {
    await ctx.addCookies(state.cookies);
  }
  const runtime = await ctx.cookies();
  const applicableToNavigation = await ctx.cookies(NAVIGATION_COOKIE_URLS);
  logger.info({ count: state.cookies.length }, "Loaded cookies");
  logger.info(
    {
      phase,
      navigationCookieUrls: NAVIGATION_COOKIE_URLS,
      applicableCount: applicableToNavigation.length,
      applicableCookies: applicableToNavigation.map(cookieSummary),
    },
    "runtime cookies applicable to 1688 navigation targets",
  );
  logCookieComparison(phase, state.cookies, runtime);
  await auditLiveContext(`${phase}_after_addCookies`, ctx, state);
}

async function logCookiesBeforeNavigation(ctx: BrowserContext, state: PlaywrightStorageState) {
  const runtime = await ctx.cookies();
  const applicableToNavigation = await ctx.cookies(NAVIGATION_COOKIE_URLS);
  logger.info(
    {
      phase: "before_first_navigation",
      runtimeCount: runtime.length,
      runtimeCookies: runtime.map(cookieSummary),
      navigationCookieUrls: NAVIGATION_COOKIE_URLS,
      applicableCount: applicableToNavigation.length,
      applicableCookies: applicableToNavigation.map(cookieSummary),
      authenticatedCookieCount: authCookieNames(runtime).length,
      authCookieNames: authCookieNames(runtime),
      cookieAuditUrls: await cookieSnapshots(ctx),
      persistedStorageState: storageStateSummary(state),
      liveStorageState: storageStateSummary(await ctx.storageState()),
    },
    "context.cookies() immediately before first navigation",
  );
  logCookieComparison("before_first_navigation", state.cookies, runtime);
}

async function logPageStorageBeforeGoto(page: Page, url: Parameters<Page["goto"]>[0]) {
  const state = await readPersistedState(authStatePath());
  const liveState = await page.context().storageState();
  const targetUrl = typeof url === "string" ? url : String(url);
  const targetCookies = await page.context().cookies(targetUrl);

  logger.info(
    {
      phase: "before_page_goto",
      contextId: contextId(page.context()),
      targetUrl,
      targetCookieCount: targetCookies.length,
      targetAuthenticatedCookieCount: authCookieNames(targetCookies).length,
      targetAuthCookieNames: authCookieNames(targetCookies),
      targetCookies: targetCookies.map(cookieSummary),
      cookieAuditUrls: await cookieSnapshots(page.context()),
      persistedStorageState: state ? storageStateSummary(state) : null,
      pageContextStorageState: storageStateSummary(liveState),
      persistedVsPageContext: state
        ? compareCookies(state.cookies, liveState.cookies)
        : null,
      originsRestored:
        state && state.origins.length > 0
          ? state.origins.every((origin) =>
              liveState.origins.some((liveOrigin) => liveOrigin.origin === origin.origin),
            )
          : null,
    },
    "page.context().storageState() immediately before page.goto",
  );
}

function instrumentPage(page: Page) {
  if (instrumentedPages.has(page)) return;
  instrumentedPages.add(page);

  const originalGoto = page.goto.bind(page);
  page.goto = (async (url: Parameters<Page["goto"]>[0], options?: Parameters<Page["goto"]>[1]) => {
    await logPageStorageBeforeGoto(page, url);
    return originalGoto(url, options);
  }) as Page["goto"];
}

function instrumentContext(ctx: BrowserContext) {
  if (instrumentedContexts.has(ctx)) return;
  instrumentedContexts.add(ctx);

  const id = contextId(ctx);
  logger.info({ contextId: id }, "instrumenting Playwright persistent context");

  for (const page of ctx.pages()) {
    instrumentPage(page);
  }

  const originalNewPage = ctx.newPage.bind(ctx);
  ctx.newPage = (async () => {
    const page = await originalNewPage();
    instrumentPage(page);
    logger.info({ contextId: id, openPages: ctx.pages().length }, "created Playwright page from shared context");
    return page;
  }) as BrowserContext["newPage"];
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
  instrumentContext(ctx);

  if (hasState) {
    const state = await readPersistedState(statePath);
    if (state) {
      await addPersistedCookies(ctx, state, "launchPersistentContext");
    } else {
      await auditLiveContext("launchPersistentContext_no_readable_state", ctx, null);
    }
  } else {
    await auditLiveContext("launchPersistentContext_no_state_file", ctx, null);
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

export async function getContext(): Promise<BrowserContext> {
  const hadExistingSingleton = contextPromise !== null;
  if (!contextPromise) {
    contextPromise = launchShared().catch((err) => {
      contextPromise = null;
      throw err;
    });
  } else {
    logger.info("getContext returning existing Playwright singleton without relaunch");
  }
  const ctx = await contextPromise;
  const state = await readPersistedState(authStatePath());
  await auditLiveContext(
    hadExistingSingleton ? "getContext_existing_singleton" : "getContext_new_singleton",
    ctx,
    state,
  );
  return ctx;
}

export async function withContext<T>(
  fn: (ctx: BrowserContext) => Promise<T>,
): Promise<T> {
  const ctx = await getContext();
  const state = await readPersistedState(authStatePath());
  if (state) {
    await logCookiesBeforeNavigation(ctx, state);
    await auditLiveContext("withContext_before_callback", ctx, state);
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
  const uploadedState = normalizeStorageState(state);
  await auditExistingSingletonBeforeUpload(uploadedState);

  // 1. Persist uploaded state to disk FIRST so the next launch seeds from it.
  await writeFile(path, JSON.stringify(uploadedState, null, 2), "utf8");
  const incoming = uploadedState.cookies;
  logger.info(
    { count: incoming.length, path, uploadedStorageState: storageStateSummary(uploadedState) },
    "persisted uploaded storage state to disk",
  );

  // 2. Tear down any pre-auth shared context — its in-memory cookie jar
  //    predates the upload. Closing forces a clean relaunch that re-seeds
  //    cookies from AUTH_STATE_PATH via launchHeadless().
  if (contextPromise) {
    logger.info("closing pre-auth shared context so it is recreated with imported cookies");
    await closeSharedContext();
    logger.info(
      { contextPromiseCleared: contextPromise === null },
      "pre-auth shared context closed before auth upload recreate",
    );
  }

  // 3. Recreate now and re-apply cookies in-memory so the first request
  //    after upload already uses the authenticated session. Do not overwrite
  //    AUTH_STATE_PATH with Chromium's runtime snapshot here — keeping the
  //    operator-uploaded file intact lets us compare uploaded vs runtime
  //    cookies exactly when diagnosing propagation issues.
  const ctx = await getContext();
  await addPersistedCookies(ctx, uploadedState, "auth_upload_recreate");

  const finalCookies = await ctx.cookies();
  const finalState = await ctx.storageState();
  logger.info(
    { loaded: incoming.length, total: finalCookies.length, authCookies: authCookieNames(finalCookies) },
    "browser recreated after auth upload",
  );
  logger.info(
    {
      phase: "auth_upload_after_upload_recreated_singleton",
      contextId: contextId(ctx),
      uploadedStorageState: storageStateSummary(uploadedState),
      liveStorageState: storageStateSummary(finalState),
      liveCookieCount: finalCookies.length,
      liveAuthenticatedCookieCount: authCookieNames(finalCookies).length,
      cookieAuditUrls: await cookieSnapshots(ctx),
      uploadedVsLive: compareCookies(uploadedState.cookies, finalCookies),
      originsRestored:
        uploadedState.origins.length > 0
          ? uploadedState.origins.every((origin) =>
              finalState.origins.some((liveOrigin) => liveOrigin.origin === origin.origin),
            )
          : null,
    },
    "auth upload completed; live singleton state after recreate",
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
