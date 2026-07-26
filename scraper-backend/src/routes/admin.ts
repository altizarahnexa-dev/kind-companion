import { Router, type Request, type Response, type NextFunction } from "express";
import { getSessionStatus } from "../lib/browser.js";
import { HttpError } from "../lib/http-error.js";
import { sendSuccess } from "../lib/response.js";

/**
 * /v1/admin/session — operator-only endpoints for the persistent Chromium
 * profile. The VPS is headless-only: manual login happens on the operator's
 * workstation via `scripts/local-login.mjs`, and the resulting Playwright
 * storageState is uploaded to `POST /v1/auth/1688/cookies`.
 *
 *   GET  /v1/admin/session/status → session diagnostics
 *   POST /v1/admin/session/open   → 410 Gone (headed login is not supported)
 *   POST /v1/admin/session/close  → 410 Gone (nothing to close on the server)
 */
export const adminRouter: Router = Router();

adminRouter.get(
  "/session/status",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const status = await getSessionStatus();
      sendSuccess(res, {
        provider: "1688",
        requestId: req.requestId,
        data: status,
      });
    } catch (err) {
      next(err);
    }
  },
);

function headedRemoved(_req: Request, _res: Response, next: NextFunction) {
  next(
    new HttpError({
      status: 410,
      code: "headed_login_disabled",
      message:
        "Server-side headed login is disabled. Run `node scripts/local-login.mjs` on your workstation to log in manually, then upload the exported storageState JSON to POST /v1/auth/1688/cookies.",
      retryable: false,
      details: {
        importEndpoint: "/v1/auth/1688/cookies",
        localUtility: "scraper-backend/scripts/local-login.mjs",
      },
    }),
  );
}

adminRouter.post("/session/open", headedRemoved);
adminRouter.post("/session/close", headedRemoved);
