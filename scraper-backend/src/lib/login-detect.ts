import type { Page } from "playwright";

/**
 * Detect whether the current page is a login wall (rather than the
 * expected search / product page). Two signals:
 *   1. URL host matches a known login host.
 *   2. A password input is present in the DOM.
 *
 * Callers should treat a match as `authentication_required`, not
 * `parse_failed` — the operator needs to reseed cookies.
 */

const LOGIN_HOST_PATTERN =
  /(^|\.)(login|passport|auth)\.(1688|taobao|tmall|alibaba)\.com/i;

export interface LoginWallInfo {
  isLoginWall: boolean;
  url: string;
  reason: "login_host" | "password_input" | null;
}

export async function detectLoginWall(page: Page): Promise<LoginWallInfo> {
  let url = "";
  try {
    url = page.url();
  } catch {
    /* ignore */
  }

  if (url && LOGIN_HOST_PATTERN.test(new URL(url).hostname)) {
    return { isLoginWall: true, url, reason: "login_host" };
  }

  let hasPassword = false;
  try {
    hasPassword = await page.evaluate(
      () => !!document.querySelector("input[type=password]"),
    );
  } catch {
    /* ignore */
  }
  if (hasPassword) return { isLoginWall: true, url, reason: "password_input" };

  return { isLoginWall: false, url, reason: null };
}
