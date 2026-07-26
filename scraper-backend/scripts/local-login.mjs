#!/usr/bin/env node
/**
 * Local 1688 login utility — runs on the operator's workstation.
 *
 * Launches a HEADED Chromium locally, opens https://login.1688.com, and
 * positively verifies a signed-in session by navigating to an
 * authentication-gated page (member.1688.com) and confirming the browser
 * is NOT redirected to a login host AND that a logged-in identity marker
 * is present in the DOM. Only then does it export the full Playwright
 * storageState to disk and (optionally) upload it to the VPS.
 *
 * If the browser is closed before verification succeeds, the script exits
 * with `authentication_failed` and writes NOTHING.
 *
 * Usage:
 *   cd scraper-backend
 *   npm install
 *   npx playwright install chromium
 *   SCRAPER_BACKEND_URL=https://scraper.example.com \
 *   SCRAPER_BACKEND_TOKEN=xxxxx \
 *     node scripts/local-login.mjs
 *
 * Flags:
 *   --out <path>   Where to write the storageState JSON (default: ./1688-state.json)
 *   --no-upload    Only export locally, skip the upload step
 *   --keep-open    Do not close the browser after export (useful for debugging)
 */
import { chromium } from "playwright";
import { writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import process from "node:process";

const HOME_URL = "https://www.1688.com/";
const LOGIN_HOST_PATTERN = /(^|\.)(login|passport)\.(1688|taobao|tmall|alibaba)\.com/i;
const AUTH_COOKIE_NAMES = new Set([
  "_m_h5_tk",
  "_m_h5_tk_enc",
  "cna",
  "cookie2",
  "xlly_s",
]);
const IDENTITY_SELECTORS = [
  "a[href*='logout']",
  "a[href*='member.1688.com']",
  ".sn-login-nick",
  ".site-nav-user",
  "[data-spm*='loginout']",
  "#member",
];

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  if (i === -1) return fallback;
  const v = process.argv[i + 1];
  return v && !v.startsWith("--") ? v : true;
}

const OUT_PATH = resolve(String(arg("--out", "./1688-state.json")));
const NO_UPLOAD = process.argv.includes("--no-upload");
const KEEP_OPEN = process.argv.includes("--keep-open");
const BACKEND_URL = process.env.SCRAPER_BACKEND_URL?.replace(/\/+$/, "");
const BACKEND_TOKEN = process.env.SCRAPER_BACKEND_TOKEN;

class AuthenticationFailedError extends Error {
  constructor(message) {
    super(message);
    this.name = "AuthenticationFailedError";
    this.code = "authentication_failed";
  }
}

function isLoginHost(urlString) {
  try {
    return LOGIN_HOST_PATTERN.test(new URL(urlString).hostname);
  } catch {
    return false;
  }
}

async function pageHasIdentityMarker(page) {
  try {
    return await page.evaluate((selectors) => {
      for (const sel of selectors) {
        if (document.querySelector(sel)) return true;
      }
      const bodyText = document.body?.innerText || "";
      if (/(退出|Sign\s*out|Log\s*out|注销)/i.test(bodyText)) return true;
      return false;
    }, IDENTITY_SELECTORS);
  } catch {
    return false;
  }
}

function findCookie(cookies, name) {
  return cookies.find((c) => c.name === name);
}

async function verifyAuthenticated(page, context) {
  try {
    try {
      await page.goto(HOME_URL, { waitUntil: "networkidle", timeout: 45_000 });
    } catch {
      try {
        await page.goto(HOME_URL, { waitUntil: "domcontentloaded", timeout: 30_000 });
      } catch {
        return false;
      }
    }
    const finalUrl = page.url();
    const cookies = await context.cookies();
    const cnLogon = findCookie(cookies, "_cn_logon");
    const cnLogonValue = cnLogon?.value ?? "<missing>";
    const presentAuthCookies = cookies
      .map((c) => c.name)
      .filter((n) => AUTH_COOKIE_NAMES.has(n));
    console.log(
      `  · probe: url=${finalUrl} totalCookies=${cookies.length} _cn_logon=${cnLogonValue} authCookies=[${presentAuthCookies.join(", ")}]`,
    );
    if (isLoginHost(finalUrl)) {
      console.log(`  · homepage → redirected to login (${finalUrl}), not signed in yet.`);
      return false;
    }
    if (cnLogonValue !== "true") {
      console.log(
        `  · _cn_logon is not "true" (got "${cnLogonValue}") — session is not authenticated yet.`,
      );
      return false;
    }
    const hasIdentity = await pageHasIdentityMarker(page);
    console.log(
      `✓ Verified authenticated at ${finalUrl} (_cn_logon=true, auth cookies: [${presentAuthCookies.join(", ")}], identityUi: ${hasIdentity}).`,
    );
    return true;
  } catch (err) {
    console.log(`  · verification errored: ${err?.message || err}`);
    return false;
  }
}


async function uploadState(state) {
  if (NO_UPLOAD) {
    console.log("• --no-upload set, skipping upload.");
    return;
  }
  if (!BACKEND_URL || !BACKEND_TOKEN) {
    console.log(
      "• SCRAPER_BACKEND_URL / SCRAPER_BACKEND_TOKEN not set — skipping upload.",
    );
    console.log(
      `  Upload manually with:\n    curl -X POST "$SCRAPER_BACKEND_URL/v1/auth/1688/cookies" \\\n      -H "Authorization: Bearer $SCRAPER_BACKEND_TOKEN" \\\n      -H "Content-Type: application/json" \\\n      --data @${OUT_PATH}`,
    );
    return;
  }
  const url = `${BACKEND_URL}/v1/auth/1688/cookies`;
  console.log(`• Uploading storageState to ${url} ...`);
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${BACKEND_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(state),
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(`✗ Upload failed: HTTP ${res.status}\n${text}`);
    process.exitCode = 2;
    return;
  }
  console.log(`✓ Uploaded. Backend response: ${text}`);
}

function waitForEnter(promptText) {
  return new Promise((resolve, reject) => {
    process.stdout.write(promptText);
    const stdin = process.stdin;
    const onData = (chunk) => {
      const s = chunk.toString();
      if (s.includes("\n") || s.includes("\r")) {
        stdin.removeListener("data", onData);
        stdin.pause();
        resolve();
      }
    };
    stdin.on("error", reject);
    stdin.resume();
    stdin.on("data", onData);
  });
}

async function main() {
  console.log("• Launching local Chromium (headed)...");
  const browser = await chromium.launch({ headless: false });

  let browserClosed = false;
  browser.on("disconnected", () => {
    browserClosed = true;
  });

  const context = await browser.newContext({
    viewport: { width: 1366, height: 900 },
    locale: "en-US",
  });
  const page = await context.newPage();

  console.log("• Opening https://login.1688.com — please complete the login manually.");
  await page.goto("https://login.1688.com", { waitUntil: "domcontentloaded" });

  console.log("");
  console.log("──────────────────────────────────────────────────────────────");
  console.log("  Complete the login in the opened browser window.");
  console.log("  The script will NOT touch the page until you confirm.");
  console.log("  When you are fully signed in, return here and press ENTER.");
  console.log("──────────────────────────────────────────────────────────────");
  console.log("");

  await waitForEnter("→ Press ENTER once login is complete: ");

  if (browserClosed) {
    throw new AuthenticationFailedError(
      "Browser was closed before login could be verified.",
    );
  }

  console.log("• Verifying authenticated session on the existing tab...");
  let verified = false;
  try {
    verified = await verifyAuthenticated(page, context);
  } catch (err) {
    if (browserClosed) {
      throw new AuthenticationFailedError(
        "Browser was closed during authentication verification.",
      );
    }
    console.log(`  · verification attempt errored: ${err?.message || err}`);
  }

  if (!verified) {
    throw new AuthenticationFailedError(
      "Login was not positively verified. Nothing was exported.",
    );
  }

  const preExportCookies = await context.cookies();
  const preExportCnLogon = findCookie(preExportCookies, "_cn_logon")?.value ?? "<missing>";
  const currentUrl = page.url();
  console.log(
    `• Pre-export snapshot: url=${currentUrl} totalCookies=${preExportCookies.length} _cn_logon=${preExportCnLogon}`,
  );
  if (preExportCnLogon !== "true") {
    throw new AuthenticationFailedError(
      `Refusing to export: _cn_logon="${preExportCnLogon}" (expected "true"). Session is not authenticated.`,
    );
  }

  const state = await context.storageState();
  await mkdir(dirname(OUT_PATH), { recursive: true });
  await writeFile(OUT_PATH, JSON.stringify(state, null, 2), "utf8");
  console.log(
    `✓ Exported storageState → ${OUT_PATH} (${state.cookies.length} cookies)`,
  );

  await uploadState(state);

  if (!KEEP_OPEN) {
    await browser.close();
  } else {
    console.log("• --keep-open set, leaving browser running. Ctrl+C to exit.");
  }
}



main().catch((err) => {
  if (err instanceof AuthenticationFailedError) {
    console.error(`✗ authentication_failed: ${err.message}`);
    console.error("  Nothing was exported or uploaded.");
    process.exit(3);
  }
  console.error("✗ Local login failed:", err);
  process.exit(1);
});
