import { Router, type Request, type Response, type NextFunction } from "express";
import {
  closeHeadedLoginContext,
  getSessionStatus,
  openHeadedLoginContext,
} from "../lib/browser.js";
import { sendSuccess } from "../lib/response.js";

/**
 * /v1/admin/session — operator-only endpoints for managing the persistent
 * Chromium profile used by the 1688 provider.
 *
 *   GET  /v1/admin/session/status → { authenticated, lastLogin, profileExists, browserRunning }
 *   POST /v1/admin/session/open   → launch headed Chromium on the shared profile,
 *                                    navigate to login.1688.com, save cookies on success.
 *   POST /v1/admin/session/close  → close the headed login browser.
 *
 * All routes inherit the API-key middleware mounted on the v1 router — never
 * mount admin routes above it.
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

adminRouter.post(
  "/session/open",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await openHeadedLoginContext();
      const status = await getSessionStatus();
      sendSuccess(res, {
        provider: "1688",
        requestId: req.requestId,
        data: {
          opened: !result.alreadyOpen,
          alreadyOpen: result.alreadyOpen,
          loginUrl: "https://login.1688.com",
          message: result.alreadyOpen
            ? "Headed login browser is already running. Complete login in that window; cookies will save automatically."
            : "Headed Chromium started on the shared profile. Complete login manually; cookies will save automatically once a signed-in session is detected.",
          ...status,
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

adminRouter.post(
  "/session/close",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await closeHeadedLoginContext();
      sendSuccess(res, {
        provider: "1688",
        requestId: req.requestId,
        data: result,
      });
    } catch (err) {
      next(err);
    }
  },
);
