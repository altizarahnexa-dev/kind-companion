import { Router, type Request } from "express";
import { z } from "zod";
import { HttpError } from "../../lib/http-error.js";
import { productLimiter, searchLimiter } from "../../middleware/rate-limit.js";

/**
 * 1688 provider routes. Endpoints are wired but every handler responds
 * 501 Not Implemented for now (Phase 3). Playwright integration lands in
 * Phase 4 by replacing the throw with a call into the scraper module.
 *
 * Validation is already in place so contract-level bugs surface before
 * the scraper is even implemented.
 */

const PROVIDER = "1688" as const;

const SearchQuerySchema = z
  .object({
    q: z.string().min(1).max(200).optional(),
    categoryId: z.string().min(1).max(64).optional(),
    page: z.coerce.number().int().min(1).max(100).default(1),
    pageSize: z.coerce.number().int().min(1).max(60).default(24),
    sort: z
      .enum(["relevance", "price_asc", "price_desc", "sales_desc", "newest"])
      .default("relevance"),
    minPrice: z.coerce.number().nonnegative().optional(),
    maxPrice: z.coerce.number().nonnegative().optional(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/i)
      .default("CNY")
      .transform((v) => v.toUpperCase()),
    country: z
      .string()
      .regex(/^[A-Z]{2}$/i)
      .optional()
      .transform((v) => v?.toUpperCase()),
    verifiedOnly: z
      .string()
      .optional()
      .transform((v) => v === "true"),
    locale: z.string().max(16).default("en"),
    refresh: z
      .string()
      .optional()
      .transform((v) => v === "true"),
  })
  .refine((v) => v.q || v.categoryId, {
    message: "Either 'q' or 'categoryId' is required.",
    path: ["q"],
  })
  .refine(
    (v) => v.minPrice === undefined || v.maxPrice === undefined || v.maxPrice >= v.minPrice,
    { message: "'maxPrice' must be greater than or equal to 'minPrice'.", path: ["maxPrice"] },
  );

const ProductParamsSchema = z.object({
  id: z.string().min(1).max(128),
});

const ProductQuerySchema = z.object({
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/i)
    .default("CNY")
    .transform((v) => v.toUpperCase()),
  country: z
    .string()
    .regex(/^[A-Z]{2}$/i)
    .optional()
    .transform((v) => v?.toUpperCase()),
  locale: z.string().max(16).default("en"),
  refresh: z
    .string()
    .optional()
    .transform((v) => v === "true"),
});

function tagProvider(req: Request) {
  (req.params as { provider?: string }).provider = PROVIDER;
}

export const sourcing1688Router: Router = Router();

// GET /v1/1688/search
sourcing1688Router.get("/search", searchLimiter, (req, _res, next) => {
  tagProvider(req);
  // Validate up front so callers get 422 instead of 501 for bad input.
  SearchQuerySchema.parse(req.query);
  next(HttpError.notImplemented("1688 search"));
});

// GET /v1/1688/product/:id
sourcing1688Router.get("/product/:id", productLimiter, (req, _res, next) => {
  tagProvider(req);
  ProductParamsSchema.parse(req.params);
  ProductQuerySchema.parse(req.query);
  next(HttpError.notImplemented("1688 product detail"));
});

// GET /v1/1688/product/:id/variants
sourcing1688Router.get(
  "/product/:id/variants",
  productLimiter,
  (req, _res, next) => {
    tagProvider(req);
    ProductParamsSchema.parse(req.params);
    ProductQuerySchema.parse(req.query);
    next(HttpError.notImplemented("1688 product variants"));
  },
);
