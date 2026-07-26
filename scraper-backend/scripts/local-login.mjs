#!/usr/bin/env node
/**
 * Local 1688 login utility — runs on the operator's workstation.
 *
 * Launches a HEADED Chromium locally, opens https://login.1688.com, and
 * waits until a signed-in session cookie appears. Then exports the full
 * Playwright storageState (cookies + localStorage) to disk and, when
 * SCRAPER_BACKEND_URL + SCRAPER_BACKEND_TOKEN are set, uploads it to the
 * VPS at POST /v1/auth/1688/cookies so the headless server can reuse it.
 *
 * Usage:
 *   cd scraper-backend
 *   npm install                 # installs playwright locally
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

const AUTH_COOKIE_HOSTS = [".1688.com", ".taobao.com", ".alibaba.com"];
const AUTH_COOKIE_NAMES =
  /^(login_aid|_tb_token_|cookie2|unb|sg|csg|_l_g_|tracknick|_nk_)/i;

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

function isSignedIn(cookies) {
  return cookies.some(
    (c) =>
      AUTH_COOKIE_HOSTS.some((h) => c.domain.endsWith(h)) &&
      AUTH_COOKIE_NAMES.test(c.name),
  );
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

async function main() {
  console.log("• Launching local Chromium (headed)...");
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    viewport: { width: 1366, height: 900 },
    locale: "en-US",
  });
  const page = await context.newPage();

  console.log("• Opening https://login.1688.com — please complete the login manually.");
  await page.goto("https://login.1688.com", { waitUntil: "domcontentloaded" });

  console.log("• Waiting for a signed-in session cookie (poll every 3s)...");
  const start = Date.now();
  const timeoutMs = 15 * 60 * 1000;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const cookies = await context.cookies();
    if (isSignedIn(cookies)) break;
    if (Date.now() - start > timeoutMs) {
      throw new Error("Timed out waiting for login after 15 minutes.");
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  console.log("✓ Signed-in session detected.");

  const state = await context.storageState();
  await mkdir(dirname(OUT_PATH), { recursive: true });
  await writeFile(OUT_PATH, JSON.stringify(state, null, 2), "utf8");
  console.log(`✓ Exported storageState → ${OUT_PATH} (${state.cookies.length} cookies)`);

  await uploadState(state);

  if (!KEEP_OPEN) {
    await browser.close();
  } else {
    console.log("• --keep-open set, leaving browser running. Ctrl+C to exit.");
  }
}

main().catch((err) => {
  console.error("✗ Local login failed:", err);
  process.exit(1);
});
