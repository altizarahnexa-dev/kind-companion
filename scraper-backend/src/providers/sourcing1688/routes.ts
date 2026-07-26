import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { HttpError } from "../../lib/http-error.js";
import { sendSuccess } from "../../lib/response.js";
import { withContext } from "../../lib/browser.js";
import { logger } from "../../lib/logger.js";
import { env } from "../../config/env.js";
import { productLimiter, searchLimiter } from "../../middleware/rate-limit.js";
import {
  navigateToProductDetail,
  navigateToSearchResults,
  parseYuanPrice,
  parseYuanPriceRange,
} from "./navigation.js";
import { extractSearchResults } from "./parsers/search-results.js";
import { extractProductDetail } from "./parsers/product-detail.js";
import { extractProductVariants } from "./parsers/product-variants.js";
import { captureParseFailure } from "../../lib/debug-capture.js";
import { detectLoginWall } from "../../lib/login-detect.js";

/**
 * 1688 provider routes — the sourcing contract endpoints.
 * Every response uses the standard envelope from lib/response.
 * Playwright errors are mapped to spec-shaped HttpError instances.
 */

const PROVIDER = "1688" as const;

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

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
  id: z.string().min(1).max(128).regex(/^[A-Za-z0-9._-]+$/, "id must be alphanumeric"),
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

// ---------------------------------------------------------------------------
// Error mapping
// ---------------------------------------------------------------------------

function tagProvider(req: Request) {
  (req.params as { provider?: string }).provider = PROVIDER;
}

/** Map any thrown value into an HttpError the error middleware can render. */
function mapPlaywrightError(err: unknown, phase: string): HttpError {
  if (err instanceof HttpError) return err;
  const e = err as { name?: string; message?: string };
  if (e?.name === "TimeoutError") {
    return new HttpError({
      status: 504,
      code: "upstream_timeout",
      message: `Upstream timed out during ${phase}.`,
      retryable: true,
      details: { phase, cause: e.message },
    });
  }
  if (
    e?.message?.includes("net::ERR_") ||
    e?.message?.includes("NS_ERROR_") ||
    e?.message?.includes("ERR_")
  ) {
    return new HttpError({
      status: 502,
      code: "upstream_unavailable",
      message: `Upstream unreachable during ${phase}.`,
      retryable: true,
      details: { phase, cause: e.message },
    });
  }
  return new HttpError({
    status: 502,
    code: "upstream_unavailable",
    message: `Scraper failed during ${phase}.`,
    retryable: true,
    details: { phase, cause: e?.message ?? "unknown" },
  });
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const sourcing1688Router: Router = Router();

// ---- GET /v1/1688/search --------------------------------------------------

sourcing1688Router.get(
  "/search",
  searchLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    tagProvider(req);
    let query: z.infer<typeof SearchQuerySchema>;
    try {
      query = SearchQuerySchema.parse(req.query);
    } catch (err) {
      return next(err);
    }
    const keyword = (query.q ?? query.categoryId!).trim();
    const timeoutMs = env.UPSTREAM_TIMEOUT_MS;

    logger.info(
      { requestId: req.requestId, provider: PROVIDER, q: keyword, page: query.page },
      "1688 search: begin",
    );

    try {
      const raw = await withContext(async (ctx) => {
        const page = await ctx.newPage();
        try {
          try {
            await navigateToSearchResults(page, keyword, {
              pageNum: query.page,
              sort: query.sort,
              timeoutMs,
            });
          } catch (navErr) {
            const wall = await detectLoginWall(page);
            if (wall.isLoginWall) {
              throw new HttpError({
                status: 401,
                code: "authentication_required",
                message: "1688 login required",
                retryable: false,
                details: { phase: "navigate", url: wall.url, reason: wall.reason },
              });
            }
            throw navErr;
          }

          const wall = await detectLoginWall(page);
          if (wall.isLoginWall) {
            throw new HttpError({
              status: 401,
              code: "authentication_required",
              message: "1688 login required",
              retryable: false,
              details: { phase: "post_navigate", url: wall.url, reason: wall.reason },
            });
          }

          const results = await extractSearchResults(page, query.pageSize);
          if (results.length === 0) {
            const wallAfterParse = await detectLoginWall(page);
            if (wallAfterParse.isLoginWall) {
              throw new HttpError({
                status: 401,
                code: "authentication_required",
                message: "1688 login required",
                retryable: false,
                details: {
                  phase: "parse",
                  url: wallAfterParse.url,
                  reason: wallAfterParse.reason,
                },
              });
            }
            const capture = await captureParseFailure(page, {
              requestId: req.requestId,
              phase: "parse",
              label: keyword,
            });
            throw new HttpError({
              status: 502,
              code: "parse_failed",
              message: "Could not extract any products from the 1688 results page.",
              retryable: true,
              details: {
                phase: "parse",
                url: capture.url,
                title: capture.title,
                screenshot: capture.screenshot,
                html: capture.html,
                signals: capture.signals,
              },
            });
          }
          return results;
        } finally {
          await page.close().catch(() => {});
        }
      });


      // Optional client-side filter for verifiedOnly / price bounds. We
      // do NOT drop items for missing price — 1688 hides some prices
      // behind login and the frontend still wants those results.
      const items = raw.map((r) => {
        const single = parseYuanPrice(r.displayed_price);
        const range = parseYuanPriceRange(r.displayed_price);
        return {
          id: `1688:${r.external_id}`,
          provider: PROVIDER,
          externalId: r.external_id,
          url: r.product_url,
          title: r.title,
          primaryImage: r.thumbnail
            ? { url: r.thumbnail, width: null, height: null }
            : undefined,
          price: single ?? {
            amountMinor: 0,
            currency: query.currency,
            display: r.displayed_price || "",
          },
          priceRange: range ?? undefined,
          minOrderQty: 1,
          salesCount: 0,
          reviewCount: 0,
          supplier: r.supplier_name
            ? {
                id: `1688:${r.supplier_name}`,
                externalId: r.supplier_name,
                name: r.supplier_name,
                country: "CN",
                verified: false,
              }
            : undefined,
          tags: [],
          fetchedAt: new Date().toISOString(),
        };
      });

      // The spec allows meta.total to be null when unknown. 1688 never
      // gives a reliable total — we advertise hasMore so the frontend
      // can keep paging.
      const hasMore = items.length >= query.pageSize;

      sendSuccess(res, {
        provider: PROVIDER,
        requestId: req.requestId,
        data: { items },
        meta: {
          page: query.page,
          pageSize: query.pageSize,
          total: null,
          hasMore,
          nextPage: hasMore ? query.page + 1 : null,
        },
        cache: { hit: false, ageSeconds: 0, ttlSeconds: 600, staleWhileRevalidateSeconds: 1800 },
      });
    } catch (err) {
      return next(mapPlaywrightError(err, "search"));
    }
  },
);

// ---- GET /v1/1688/product/:id --------------------------------------------

sourcing1688Router.get(
  "/product/:id",
  productLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    tagProvider(req);
    let params: z.infer<typeof ProductParamsSchema>;
    let query: z.infer<typeof ProductQuerySchema>;
    try {
      params = ProductParamsSchema.parse(req.params);
      query = ProductQuerySchema.parse(req.query);
    } catch (err) {
      return next(err);
    }

    logger.info(
      { requestId: req.requestId, provider: PROVIDER, id: params.id },
      "1688 product detail: begin",
    );

    try {
      const [detail, variantSet] = await withContext(async (ctx) => {
        const page = await ctx.newPage();
        try {
          await navigateToProductDetail(page, params.id, env.UPSTREAM_TIMEOUT_MS);
          const d = await extractProductDetail(page);
          const v = await extractProductVariants(page).catch(() => ({
            options: [],
            variants: [],
          }));
          return [d, v] as const;
        } finally {
          await page.close().catch(() => {});
        }
      });

      if (!detail.title && detail.images.length === 0) {
        throw new HttpError({
          status: 502,
          code: "parse_failed",
          message: "Could not extract product detail from the 1688 offer page.",
          retryable: true,
          details: { phase: "parse" },
        });
      }

      const priceMoney = parseYuanPrice(detail.priceDisplay);
      const priceRange = parseYuanPriceRange(detail.priceDisplay);

      const images = detail.images.map((url, i) => ({
        url,
        position: i,
        isPrimary: i === 0,
      }));

      const variants = variantSet.variants.map((v) => ({
        id: `1688:${params.id}:${v.externalId}`,
        externalId: v.externalId,
        sku: v.sku,
        title: v.title,
        attributes: v.attributes,
        price: v.amountMinor !== null
          ? { amountMinor: v.amountMinor, currency: v.currency, display: v.priceDisplay }
          : (priceMoney ?? { amountMinor: 0, currency: query.currency, display: v.priceDisplay }),
        stock: v.stock,
        minOrderQty: detail.minOrderQty ?? 1,
        image: v.image ? { url: v.image } : undefined,
        available: v.available,
      }));

      sendSuccess(res, {
        provider: PROVIDER,
        requestId: req.requestId,
        data: {
          id: `1688:${params.id}`,
          provider: PROVIDER,
          externalId: params.id,
          url: `https://detail.1688.com/offer/${params.id}.html`,
          title: detail.title,
          description: detail.description,
          descriptionHtml: detail.descriptionHtml,
          images,
          price: priceMoney ?? {
            amountMinor: 0,
            currency: query.currency,
            display: detail.priceDisplay || "",
          },
          priceRange: priceRange ?? undefined,
          minOrderQty: detail.minOrderQty ?? 1,
          stock: detail.stock,
          attributes: detail.attributes,
          shipping: {
            originCountry: "CN",
            leadTimeDays: undefined,
          },
          supplier: {
            id: detail.supplier.name ? `1688:${detail.supplier.name}` : `1688:unknown`,
            provider: PROVIDER,
            externalId: detail.supplier.name || "unknown",
            url: detail.supplier.url || undefined,
            name: detail.supplier.name || "Unknown supplier",
            country: detail.supplier.country,
            verified: detail.supplier.verified,
          },
          variants,
          fetchedAt: new Date().toISOString(),
        },
        cache: { hit: false, ageSeconds: 0, ttlSeconds: 1800, staleWhileRevalidateSeconds: 7200 },
      });
    } catch (err) {
      return next(mapPlaywrightError(err, "product_detail"));
    }
  },
);

// ---- GET /v1/1688/product/:id/variants ------------------------------------

sourcing1688Router.get(
  "/product/:id/variants",
  productLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    tagProvider(req);
    let params: z.infer<typeof ProductParamsSchema>;
    let query: z.infer<typeof ProductQuerySchema>;
    try {
      params = ProductParamsSchema.parse(req.params);
      query = ProductQuerySchema.parse(req.query);
    } catch (err) {
      return next(err);
    }

    logger.info(
      { requestId: req.requestId, provider: PROVIDER, id: params.id },
      "1688 variants: begin",
    );

    try {
      const variantSet = await withContext(async (ctx) => {
        const page = await ctx.newPage();
        try {
          await navigateToProductDetail(page, params.id, env.UPSTREAM_TIMEOUT_MS);
          return await extractProductVariants(page);
        } finally {
          await page.close().catch(() => {});
        }
      });

      const variants = variantSet.variants.map((v) => ({
        id: `1688:${params.id}:${v.externalId}`,
        externalId: v.externalId,
        sku: v.sku,
        title: v.title,
        attributes: v.attributes,
        price:
          v.amountMinor !== null
            ? { amountMinor: v.amountMinor, currency: v.currency, display: v.priceDisplay }
            : { amountMinor: 0, currency: query.currency, display: v.priceDisplay },
        stock: v.stock,
        image: v.image ? { url: v.image } : undefined,
        available: v.available,
      }));

      sendSuccess(res, {
        provider: PROVIDER,
        requestId: req.requestId,
        data: {
          productId: `1688:${params.id}`,
          variants,
          options: variantSet.options,
        },
        cache: { hit: false, ageSeconds: 0, ttlSeconds: 900, staleWhileRevalidateSeconds: 3600 },
      });
    } catch (err) {
      return next(mapPlaywrightError(err, "product_variants"));
    }
  },
);
