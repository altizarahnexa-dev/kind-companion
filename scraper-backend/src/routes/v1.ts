import { Router } from "express";
import { apiKeyAuth } from "../middleware/auth.js";
import { globalLimiter } from "../middleware/rate-limit.js";
import { healthRouter } from "./health.js";
import { authRouter } from "./auth.js";
import { adminRouter } from "./admin.js";
import { sourcing1688Router } from "../providers/sourcing1688/routes.js";
import { diagnosticsRouter } from "./diagnostics.js";

/**
 * v1 router. Mount order matters:
 *   1. /health is public (no auth, no rate limit).
 *   2. Everything else requires an API key + is globally rate-limited.
 *   3. Provider sub-routers add their own tighter rate limits per endpoint.
 */
export const v1Router: Router = Router();

// Public
v1Router.use("/", healthRouter);

// Authenticated
v1Router.use(apiKeyAuth);
v1Router.use(globalLimiter);

// Session/cookie management for the persistent Chromium context.
v1Router.use("/auth", authRouter);

// Diagnostics (Playwright infra checks — not part of the sourcing contract)
v1Router.use("/diagnostics", diagnosticsRouter);

// Providers
v1Router.use("/1688", sourcing1688Router);

// Future providers plug in here:
// v1Router.use("/alibaba", alibabaRouter);
// v1Router.use("/taobao", taobaoRouter);
// v1Router.use("/aliexpress", aliexpressRouter);
