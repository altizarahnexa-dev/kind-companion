/**
 * Server-only helpers for the 1688 provider. Talks to the self-hosted
 * Scraper Backend over HTTPS. Never imported from client code directly —
 * only from `sourcing1688.functions.ts` inside a `createServerFn` handler.
 */
import type {
  Money,
  Page,
  ProductSummary,
  SearchRequest,
} from "../domain/types";

const PROVIDER = "sourcing_1688" as const;

export interface BackendSearchItem {
  id?: string;
  provider?: string;
  externalId: string;
  url?: string;
  title: string;
  slug?: string;
  primaryImage?: { url: string; width?: number; height?: number; alt?: string };
  price?: { amountMinor: number; currency: string; display?: string };
  priceRange?: { minMinor: number; maxMinor: number; currency: string };
  minOrderQty?: number;
  salesCount?: number;
  rating?: number;
  reviewCount?: number;
  supplier?: {
    id?: string;
    externalId?: string;
    name: string;
    country?: string;
    verified?: boolean;
  };
  tags?: string[];
  fetchedAt?: string;
}

interface BackendSuccess {
  ok: true;
  provider: string;
  requestId: string;
  data: { items: BackendSearchItem[] };
  meta?: {
    page?: number;
    pageSize?: number;
    total?: number | null;
    hasMore?: boolean;
    nextPage?: number | null;
  };
}

interface BackendError {
  ok: false;
  provider?: string;
  requestId?: string;
  error: {
    code: string;
    message: string;
    retryable?: boolean;
    retryAfterMs?: number;
    details?: Record<string, unknown>;
  };
}

export class SourcingBackendError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryable: boolean;
  readonly retryAfterMs?: number;
  constructor(opts: {
    status: number;
    code: string;
    message: string;
    retryable?: boolean;
    retryAfterMs?: number;
  }) {
    super(opts.message);
    this.name = "SourcingBackendError";
    this.status = opts.status;
    this.code = opts.code;
    this.retryable = opts.retryable ?? opts.status >= 500;
    this.retryAfterMs = opts.retryAfterMs;
  }
}

function readEnv(): { baseUrl: string; token: string } {
  const baseUrl = process.env.SCRAPER_BACKEND_URL;
  const token = process.env.SCRAPER_BACKEND_TOKEN;
  if (!baseUrl || !token) {
    const missing = [
      ...(!baseUrl ? ["SCRAPER_BACKEND_URL"] : []),
      ...(!token ? ["SCRAPER_BACKEND_TOKEN"] : []),
    ].join(", ");
    throw new SourcingBackendError({
      status: 500,
      code: "backend_not_configured",
      message: `Scraper backend not configured. Missing: ${missing}.`,
      retryable: false,
    });
  }
  return { baseUrl: baseUrl.replace(/\/+$/, ""), token };
}

function randomUUID(): string {
  // Node/Worker runtime both expose Web Crypto.
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  // Fallback (should not hit in worker/node)
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function mapStatusToCode(status: number, fallback = "upstream_error"): string {
  switch (status) {
    case 401:
      return "unauthorized";
    case 403:
      return "forbidden";
    case 404:
      return "not_found";
    case 422:
      return "validation_error";
    case 429:
      return "rate_limited";
    case 501:
      return "backend_provider_not_implemented";
    case 502:
      return "upstream_unavailable";
    case 504:
      return "upstream_timeout";
    default:
      return fallback;
  }
}

function buildSearchUrl(base: string, req: SearchRequest): string {
  const params = new URLSearchParams();
  if (req.query) params.set("q", req.query);
  if (req.categoryId) params.set("categoryId", req.categoryId);
  params.set("page", String(req.page ?? 1));
  params.set("pageSize", String(req.pageSize ?? 24));
  if (req.sort) {
    // Domain sort values map 1:1 to backend, except "rating" which the
    // backend does not support — fall back to sales_desc.
    const backendSort =
      req.sort === "rating"
        ? "sales_desc"
        : req.sort === "sales"
          ? "sales_desc"
          : req.sort;
    params.set("sort", backendSort);
  }
  if (req.minPriceMinor !== undefined) params.set("minPrice", String(req.minPriceMinor));
  if (req.maxPriceMinor !== undefined) params.set("maxPrice", String(req.maxPriceMinor));
  if (req.currency) params.set("currency", req.currency);
  return `${base}/v1/1688/search?${params.toString()}`;
}

function toMoney(
  price: BackendSearchItem["price"],
  range: BackendSearchItem["priceRange"],
): Money {
  if (price && typeof price.amountMinor === "number" && price.currency) {
    return { amountMinor: price.amountMinor, currency: price.currency };
  }
  if (range && typeof range.minMinor === "number" && range.currency) {
    return { amountMinor: range.minMinor, currency: range.currency };
  }
  return { amountMinor: 0, currency: "CNY" };
}

function mapItem(raw: BackendSearchItem): ProductSummary {
  return {
    id: raw.id ?? `1688:${raw.externalId}`,
    provider: PROVIDER,
    externalId: raw.externalId,
    slug: raw.slug,
    title: raw.title,
    primaryImage: raw.primaryImage?.url,
    price: toMoney(raw.price, raw.priceRange),
    minOrderQty: raw.minOrderQty ?? 1,
    rating: raw.rating,
    reviewCount: raw.reviewCount ?? 0,
    salesCount: raw.salesCount ?? 0,
    supplier: raw.supplier
      ? {
          id: raw.supplier.id ?? `1688:${raw.supplier.externalId ?? "unknown"}`,
          name: raw.supplier.name,
          country: raw.supplier.country,
          verified: raw.supplier.verified ?? false,
        }
      : undefined,
  };
}

export async function searchProducts1688(
  req: SearchRequest,
): Promise<Page<ProductSummary>> {
  const { baseUrl, token } = readEnv();
  const url = buildSearchUrl(baseUrl, req);
  const requestId = randomUUID();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);

  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "X-Request-Id": requestId,
        "X-Client-Version": "marketplace-frontend/1.0",
      },
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeout);
    const isAbort = err instanceof Error && err.name === "AbortError";
    throw new SourcingBackendError({
      status: isAbort ? 504 : 502,
      code: isAbort ? "upstream_timeout" : "upstream_unavailable",
      message: isAbort
        ? "Scraper backend did not respond in time."
        : "Could not reach the scraper backend.",
      retryable: true,
    });
  }
  clearTimeout(timeout);

  const bodyText = await response.text();
  let parsed: BackendSuccess | BackendError | undefined;
  try {
    parsed = bodyText ? (JSON.parse(bodyText) as BackendSuccess | BackendError) : undefined;
  } catch {
    /* fall through */
  }

  if (!response.ok || !parsed || parsed.ok === false) {
    const err = (parsed as BackendError | undefined)?.error;
    const upstreamCode = err?.code ?? mapStatusToCode(response.status);
    const upstreamMessage =
      response.status === 501 || err?.code === "not_implemented"
        ? "The configured scraper backend still returns 501 Not Implemented for 1688 search. Deploy the current scraper-backend build on the VPS so /v1/1688/search uses the Playwright implementation."
        : err?.message ?? `Scraper backend returned HTTP ${response.status}.`;
    throw new SourcingBackendError({
      status: response.status || 502,
      code: upstreamCode,
      message: upstreamMessage,
      retryable: err?.retryable ?? (response.status >= 500 || response.status === 429),
      retryAfterMs: err?.retryAfterMs,
    });
  }

  const items = (parsed.data?.items ?? []).map(mapItem);
  const page = parsed.meta?.page ?? req.page ?? 1;
  const pageSize = parsed.meta?.pageSize ?? req.pageSize ?? 24;
  const total = parsed.meta?.total ?? items.length;
  const hasMore = parsed.meta?.hasMore ?? false;

  return { items, page, pageSize, total: total ?? 0, hasMore };
}
