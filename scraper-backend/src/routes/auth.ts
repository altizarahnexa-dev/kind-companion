import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import express from "express";
import {
  exportStorageState,
  importStorageState,
  isAuthenticated,
  authStatePath,
} from "../lib/browser.js";
import { HttpError } from "../lib/http-error.js";
import { sendSuccess } from "../lib/response.js";

/**
 * /v1/auth/1688 — operator endpoints for managing the persistent session.
 *
 *   GET  /v1/auth/1688/status   → { authenticated, cookieCount }
 *   GET  /v1/auth/1688/cookies  → storageState JSON (cookies + origins)
 *   POST /v1/auth/1688/cookies  → import storageState JSON, persist to disk
 *
 * Called by trusted operators with the same bearer API key used for the
 * scraping endpoints. Do NOT expose publicly.
 */

const StorageStateSchema = z.object({
  cookies: z
    .array(
      z.object({
        name: z.string(),
        value: z.string(),
        domain: z.string(),
        path: z.string(),
        expires: z.number().optional(),
        httpOnly: z.boolean().optional(),
        secure: z.boolean().optional(),
        sameSite: z.enum(["Strict", "Lax", "None"]).optional(),
      }),
    )
    .default([]),
  origins: z.array(z.unknown()).optional(),
});

export const authRouter: Router = Router();

// Accept larger JSON bodies here (cookie exports can be > 64kb).
const jsonParser = express.json({ limit: "2mb" });

authRouter.get(
  "/1688/status",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const authenticated = await isAuthenticated();
      sendSuccess(res, {
        provider: "1688",
        requestId: req.requestId,
        data: { authenticated },
      });
    } catch (err) {
      next(err);
    }
  },
);

authRouter.get(
  "/1688/cookies",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const state = await exportStorageState();
      sendSuccess(res, {
        provider: "1688",
        requestId: req.requestId,
        data: state,
      });
    } catch (err) {
      next(err);
    }
  },
);

authRouter.post(
  "/1688/cookies",
  jsonParser,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = StorageStateSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new HttpError({
          status: 422,
          code: "validation_error",
          message: "Body must be a Playwright storageState JSON object.",
          retryable: false,
          details: { issues: parsed.error.issues },
        });
      }
      const result = await importStorageState(parsed.data);
      const authenticated = await isAuthenticated();
      sendSuccess(res, {
        provider: "1688",
        requestId: req.requestId,
        data: {
          imported: result.cookies,
          persistedTo: result.path,
          authenticated,
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

export { authStatePath };
