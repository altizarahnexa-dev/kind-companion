# SCRAPER_BACKEND_SPEC.md

**API version:** `v1`
**Owner of this spec:** the marketplace frontend (this repo).
**Owner of the implementation:** the self-hosted Playwright backend on the VPS.
**Status:** contract frozen. The frontend depends on this exact shape.

The frontend does **not** scrape. It only talks to this backend. Every
sourcing provider (`1688`, `alibaba`, `taobao`, `aliexpress`) is exposed
through the same endpoint shape under `/v1/{provider}/…`. This spec uses
`1688` as the canonical example; the other providers are structurally
identical.

---

## 1. Base URL & Versioning

- **Base URL:** `https://<your-vps-host>/v1`
- **Versioning:** in the URL path. Breaking changes require a new prefix
  (`/v2/...`). Additive changes (new optional fields) stay on `/v1`.
- **Content type:** `application/json; charset=utf-8` for all requests
  and responses. `POST` bodies (none in this spec today) would also be
  JSON.
- **Encoding:** UTF-8. All query values must be URL-encoded.
- **CORS:** the backend must allow the frontend's production and preview
  origins with `GET, OPTIONS` and headers `Authorization,
  Content-Type, X-Request-Id, X-Client-Version`.

---

## 2. Authentication

- **Scheme:** static bearer token issued by the VPS operator.
- **Header:** `Authorization: Bearer <SCRAPER_BACKEND_TOKEN>`
- The token is stored in the frontend as a **server-side secret**
  (`SCRAPER_BACKEND_TOKEN`) and never shipped to the browser. All calls
  originate from `createServerFn` handlers or `src/routes/api/*` server
  routes.
- **Optional hardening (recommended):**
  - `X-Client-Id: marketplace-frontend`
  - HMAC signature header `X-Signature: sha256=<hex>` computed over
    `${method}\n${path}\n${timestamp}\n${body}` using a shared secret,
    with `X-Timestamp` in seconds and a ±300s window.
- **Unauthenticated / bad token:** `401 unauthorized`.
- **Authenticated but not allowed** (e.g. provider disabled for this
  client): `403 forbidden`.

---

## 3. Standard Request Headers

| Header             | Required | Purpose                                                     |
|--------------------|----------|-------------------------------------------------------------|
| `Authorization`    | yes      | `Bearer <token>`                                            |
| `Accept`           | yes      | `application/json`                                          |
| `X-Request-Id`     | yes      | Client-generated UUID v4. Echoed back for tracing.          |
| `X-Client-Version` | no       | Frontend build/version string.                              |
| `Accept-Language`  | no       | BCP-47 tag, e.g. `en`, `zh-CN`. Backend may translate text. |
| `X-Timestamp`      | no       | Unix seconds; required if HMAC is enabled.                  |
| `X-Signature`      | no       | HMAC-SHA256 signature; required if HMAC is enabled.         |

The backend MUST echo `X-Request-Id` in the response and include it in
every log line related to the request.

---

## 4. Standard Response Envelope

Every 2xx response uses this shape:

```json
{
  "ok": true,
  "provider": "1688",
  "requestId": "b4b2b0a1-...-...",
  "cache": { "hit": false, "ageSeconds": 0, "ttlSeconds": 600 },
  "data": { /* endpoint-specific payload */ },
  "meta": { /* endpoint-specific, e.g. pagination */ }
}
```

Every non-2xx response uses this shape:

```json
{
  "ok": false,
  "provider": "1688",
  "requestId": "b4b2b0a1-...-...",
  "error": {
    "code": "upstream_timeout",
    "message": "Upstream did not respond in time.",
    "retryable": true,
    "retryAfterMs": 1500,
    "details": { "phase": "search", "attempt": 2 }
  }
}
```

`error.code` is a stable machine-readable string. `error.message` is
human-readable, English, safe to log. `details` is optional and free-form.

---

## 5. Endpoint List (v1)

All endpoints are `GET`, idempotent, cacheable.

| Method | Path                                       | Purpose                        |
|--------|--------------------------------------------|--------------------------------|
| GET    | `/v1/health`                               | Liveness/readiness probe       |
| GET    | `/v1/1688/search`                          | Product search                 |
| GET    | `/v1/1688/product/:id`                     | Product detail                 |
| GET    | `/v1/1688/product/:id/variants`            | Product variants (SKUs)        |
| GET    | `/v1/1688/supplier/:id`                    | Supplier detail (recommended)  |
| GET    | `/v1/1688/categories`                      | Category tree (recommended)    |

Recommended endpoints are optional in v1 but must follow the same
envelope and shape rules when implemented. The frontend will feature-detect
via `/v1/health`.

---

## 6. Endpoint: `GET /v1/health`

Liveness / readiness. No auth required. No cache.

**Response 200:**

```json
{
  "ok": true,
  "service": "scraper-backend",
  "version": "1.4.2",
  "uptimeSeconds": 91823,
  "providers": {
    "1688":      { "enabled": true,  "healthy": true  },
    "alibaba":   { "enabled": false, "healthy": false },
    "taobao":    { "enabled": false, "healthy": false },
    "aliexpress":{ "enabled": false, "healthy": false }
  }
}
```

---

## 7. Endpoint: `GET /v1/1688/search`

### 7.1 Query parameters

| Name         | Type    | Required | Default   | Notes                                                             |
|--------------|---------|----------|-----------|-------------------------------------------------------------------|
| `q`          | string  | yes*     | —         | Search keyword. UTF-8. 1–200 chars. *Required unless `categoryId` |
| `categoryId` | string  | yes*     | —         | Native category id on the provider. *Required unless `q`          |
| `page`       | integer | no       | `1`       | 1-based                                                           |
| `pageSize`   | integer | no       | `24`      | 1–60                                                              |
| `sort`       | enum    | no       | `relevance` | `relevance` \| `price_asc` \| `price_desc` \| `sales_desc` \| `newest` |
| `minPrice`   | number  | no       | —         | Minor units of `currency` (e.g. cents). Non-negative              |
| `maxPrice`   | number  | no       | —         | Must be ≥ `minPrice`                                              |
| `currency`   | string  | no       | `CNY`     | ISO-4217. Backend converts prices to this currency if supported   |
| `country`    | string  | no       | —         | ISO-3166 alpha-2 buyer country (for shipping-aware pricing)       |
| `verifiedOnly` | bool  | no       | `false`   | Only verified suppliers                                           |
| `locale`     | string  | no       | `en`      | Response text locale. Overrides `Accept-Language`                 |
| `refresh`    | bool    | no       | `false`   | Bypass backend cache. Rate-limited server-side                    |

Unknown query params MUST be ignored, not rejected.

### 7.2 Response 200 — `data` shape

```json
{
  "items": [ /* SearchResultItem[] */ ],
  "facets": { /* optional, see 7.4 */ }
}
```

### 7.3 Response 200 — `meta` shape (pagination)

```json
{
  "page": 1,
  "pageSize": 24,
  "total": 1832,
  "totalPages": 77,
  "hasMore": true,
  "nextPage": 2
}
```

- `total` is a best-effort count. If the upstream does not expose it,
  the backend MAY return `total: null` and MUST still return
  `hasMore` truthfully.
- Pagination is page-based. Cursor pagination is a v2 concern.

### 7.4 `facets` (optional)

```json
{
  "categories": [{ "id": "12345", "name": "Bluetooth speakers", "count": 214 }],
  "priceBuckets": [{ "minMinor": 0, "maxMinor": 5000, "count": 88 }]
}
```

### 7.5 `SearchResultItem` (canonical)

```json
{
  "id": "1688:0123456789",
  "provider": "1688",
  "externalId": "0123456789",
  "url": "https://detail.1688.com/offer/0123456789.html",
  "title": "Portable Bluetooth 5.3 speaker, IPX7",
  "slug": "portable-bluetooth-5-3-speaker-ipx7",
  "primaryImage": {
    "url": "https://cdn.example.com/img/abc.webp",
    "width": 800,
    "height": 800,
    "alt": "Portable speaker"
  },
  "price": {
    "amountMinor": 4599,
    "currency": "CNY",
    "display": "¥45.99"
  },
  "priceRange": {
    "minMinor": 3999,
    "maxMinor": 6299,
    "currency": "CNY"
  },
  "minOrderQty": 2,
  "salesCount": 1523,
  "rating": 4.7,
  "reviewCount": 214,
  "supplier": {
    "id": "1688:sup_98765",
    "externalId": "sup_98765",
    "name": "Shenzhen Audio Co., Ltd.",
    "country": "CN",
    "verified": true
  },
  "tags": ["hot", "new"],
  "fetchedAt": "2026-07-25T12:34:56Z"
}
```

### 7.6 Full example — request

```
GET /v1/1688/search?q=bluetooth%20speaker&page=1&pageSize=2&sort=sales_desc&currency=CNY HTTP/1.1
Host: scraper.example.com
Authorization: Bearer sbk_live_...
Accept: application/json
Accept-Language: en
X-Request-Id: 7c6e7a3d-2a71-4f45-9d8e-2d1b8b4b9f0a
```

### 7.7 Full example — response 200

```json
{
  "ok": true,
  "provider": "1688",
  "requestId": "7c6e7a3d-2a71-4f45-9d8e-2d1b8b4b9f0a",
  "cache": { "hit": true, "ageSeconds": 42, "ttlSeconds": 600 },
  "data": {
    "items": [
      {
        "id": "1688:0123456789",
        "provider": "1688",
        "externalId": "0123456789",
        "url": "https://detail.1688.com/offer/0123456789.html",
        "title": "Portable Bluetooth 5.3 speaker, IPX7",
        "primaryImage": { "url": "https://cdn.example.com/img/abc.webp", "width": 800, "height": 800 },
        "price": { "amountMinor": 4599, "currency": "CNY", "display": "¥45.99" },
        "priceRange": { "minMinor": 3999, "maxMinor": 6299, "currency": "CNY" },
        "minOrderQty": 2,
        "salesCount": 1523,
        "rating": 4.7,
        "reviewCount": 214,
        "supplier": { "id": "1688:sup_98765", "externalId": "sup_98765", "name": "Shenzhen Audio Co., Ltd.", "country": "CN", "verified": true },
        "tags": ["hot"],
        "fetchedAt": "2026-07-25T12:34:56Z"
      },
      {
        "id": "1688:0987654321",
        "provider": "1688",
        "externalId": "0987654321",
        "url": "https://detail.1688.com/offer/0987654321.html",
        "title": "Mini wireless speaker with RGB light",
        "primaryImage": { "url": "https://cdn.example.com/img/xyz.webp", "width": 800, "height": 800 },
        "price": { "amountMinor": 2899, "currency": "CNY", "display": "¥28.99" },
        "minOrderQty": 5,
        "salesCount": 980,
        "rating": 4.5,
        "reviewCount": 122,
        "supplier": { "id": "1688:sup_11223", "externalId": "sup_11223", "name": "Guangzhou Sound Ltd.", "country": "CN", "verified": true },
        "tags": [],
        "fetchedAt": "2026-07-25T12:34:56Z"
      }
    ]
  },
  "meta": { "page": 1, "pageSize": 2, "total": 1832, "totalPages": 916, "hasMore": true, "nextPage": 2 }
}
```

---

## 8. Endpoint: `GET /v1/1688/product/:id`

### 8.1 Path & query

- `:id` — provider `externalId` (URL-encoded). 1–128 chars.
- Query: `currency`, `country`, `locale`, `refresh` (same semantics as
  search).

### 8.2 Response 200 — `data` shape (`ProductDetail`)

```json
{
  "id": "1688:0123456789",
  "provider": "1688",
  "externalId": "0123456789",
  "url": "https://detail.1688.com/offer/0123456789.html",
  "title": "Portable Bluetooth 5.3 speaker, IPX7",
  "slug": "portable-bluetooth-5-3-speaker-ipx7",
  "description": "Plain-text or sanitized HTML. HTML must be sanitized server-side.",
  "descriptionHtml": "<p>...</p>",
  "categoryPath": [
    { "id": "100", "name": "Consumer Electronics" },
    { "id": "112", "name": "Audio" },
    { "id": "112.7", "name": "Bluetooth speakers" }
  ],
  "images": [
    { "url": "https://cdn.example.com/img/abc-1.webp", "width": 1200, "height": 1200, "position": 0, "isPrimary": true },
    { "url": "https://cdn.example.com/img/abc-2.webp", "width": 1200, "height": 1200, "position": 1 }
  ],
  "price": {
    "amountMinor": 4599,
    "currency": "CNY",
    "display": "¥45.99"
  },
  "priceTiers": [
    { "minQty": 2,  "price": { "amountMinor": 4599, "currency": "CNY" } },
    { "minQty": 50, "price": { "amountMinor": 4199, "currency": "CNY" } },
    { "minQty": 500,"price": { "amountMinor": 3899, "currency": "CNY" } }
  ],
  "minOrderQty": 2,
  "stock": 12480,
  "attributes": {
    "Brand": "Generic",
    "Battery": "1200 mAh",
    "Bluetooth": "5.3"
  },
  "shipping": {
    "originCountry": "CN",
    "leadTimeDays": { "min": 3, "max": 7 }
  },
  "supplier": { /* SupplierSummary — see §10 */ },
  "variants": [ /* Variant[] — see §11. MAY be omitted; frontend falls back to /variants */ ],
  "fetchedAt": "2026-07-25T12:34:56Z"
}
```

### 8.3 Response 404

Product does not exist upstream (verified, not just a fetch failure):

```json
{
  "ok": false,
  "provider": "1688",
  "requestId": "…",
  "error": { "code": "not_found", "message": "Product not found.", "retryable": false }
}
```

---

## 9. Endpoint: `GET /v1/1688/product/:id/variants`

### 9.1 Path & query

- `:id` — provider `externalId`.
- Query: `currency`, `country`, `locale`, `refresh`.

### 9.2 Response 200 — `data` shape

```json
{
  "productId": "1688:0123456789",
  "variants": [ /* Variant[] */ ],
  "options": [
    { "name": "Color", "values": ["Black", "White", "Blue"] },
    { "name": "Plug",  "values": ["EU", "US", "UK"] }
  ]
}
```

### 9.3 `Variant` shape (§11)

```json
{
  "id": "1688:0123456789:sku_abc",
  "externalId": "sku_abc",
  "sku": "BT-SPK-BLK-EU",
  "title": "Black / EU",
  "attributes": { "Color": "Black", "Plug": "EU" },
  "price": { "amountMinor": 4599, "currency": "CNY", "display": "¥45.99" },
  "stock": 320,
  "minOrderQty": 2,
  "image": { "url": "https://cdn.example.com/img/abc-black.webp", "width": 800, "height": 800 },
  "available": true
}
```

Rules:

- `variants` MUST be a (possibly empty) array. A product with no
  configurable options returns `variants: []`, not `null`.
- Every variant's `attributes` keys MUST be a subset of the `options[].name`.
- Variant prices MUST use the same currency as the request (or the
  provider's native currency if conversion is unsupported — but must
  match across all variants of a single response).

---

## 10. `Supplier` format (§10)

Full shape returned by `/v1/1688/supplier/:id` and embedded (as summary)
in search results and product details.

```json
{
  "id": "1688:sup_98765",
  "provider": "1688",
  "externalId": "sup_98765",
  "url": "https://sup_98765.1688.com",
  "name": "Shenzhen Audio Co., Ltd.",
  "slug": "shenzhen-audio",
  "logo": { "url": "https://cdn.example.com/logos/98765.webp", "width": 256, "height": 256 },
  "country": "CN",
  "region": "Guangdong",
  "city": "Shenzhen",
  "yearsActive": 8,
  "verified": true,
  "verifiedType": "gold_supplier",
  "rating": 4.8,
  "reviewCount": 3421,
  "responseRateBps": 9600,
  "onTimeDeliveryBps": 9800,
  "employeeCount": "51-100",
  "mainProducts": ["Bluetooth speakers", "Earbuds"],
  "certifications": ["ISO9001", "BSCI"],
  "fetchedAt": "2026-07-25T12:34:56Z"
}
```

Notes:

- Percent-like fields are integers in **basis points** (10 000 = 100.00 %)
  to avoid float drift.
- `verified` is the boolean flag the UI cares about; `verifiedType`
  carries the provider-specific label.

The summary embedded in `SearchResultItem`/`ProductDetail` MUST include
at least: `id`, `externalId`, `name`, `country`, `verified`.

---

## 11. `Variant` format — see §9.3.

## 12. `Image` format

```json
{
  "url": "https://cdn.example.com/img/abc.webp",
  "width": 1200,
  "height": 1200,
  "alt": "Optional descriptive text",
  "position": 0,
  "isPrimary": true
}
```

Rules:

- `url` MUST be absolute HTTPS. HTTP URLs MUST be rewritten to HTTPS or
  proxied by the backend.
- Preferred formats: `webp` > `jpeg` > `png`. `avif` allowed.
- The backend SHOULD host images on its own CDN (or a proxying route,
  e.g. `GET /v1/img?src=…`) so hotlink protection at the upstream never
  reaches the browser.
- `width` and `height` are pixels and SHOULD be included whenever known
  to prevent layout shift on the frontend.
- If multiple sizes are available, expose them as siblings
  (`thumbnail`, `medium`, `original`) — additive change, safe in v1.

## 13. `Currency` / `Money` format

```json
{
  "amountMinor": 4599,
  "currency": "CNY",
  "display": "¥45.99"
}
```

- `amountMinor` is an **integer** in the currency's minor unit (cents,
  fen, …). Never a float. Prevents FP rounding.
- `currency` is ISO-4217 uppercase.
- `display` is optional, backend-localized, safe to log; the frontend
  will re-format when needed.
- Zero-decimal currencies (JPY, KRW, …): `amountMinor` still uses the
  smallest unit defined by ISO-4217 (for JPY that is 1 JPY).

---

## 14. Timeouts

| Layer                          | Timeout          |
|--------------------------------|------------------|
| Frontend → backend (per call)  | **8 s**          |
| Backend → upstream site        | **15 s**         |
| Full search request budget     | **20 s**         |
| Full product detail budget     | **25 s**         |
| `/v1/health`                   | 2 s              |

If the backend cannot answer within its budget, it MUST respond
`504 upstream_timeout` (see §17) rather than hanging. Long-poll,
streaming, or WebSocket variants are out of scope for v1.

---

## 15. Rate Limiting

Per-token limits enforced by the backend:

| Bucket                     | Limit                       |
|----------------------------|-----------------------------|
| Global                     | 60 req / 10 s               |
| `/v1/*/search`             | 20 req / 10 s               |
| `/v1/*/product/*`          | 40 req / 10 s               |
| `refresh=true` (any path)  | 5 req / minute              |

Response headers on **every** response (2xx and 4xx):

```
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 42
X-RateLimit-Reset: 1761393600      # unix seconds
Retry-After: 3                     # seconds, only on 429
```

Over-limit response: `429 rate_limited` (see §17). The frontend
respects `Retry-After` and never busy-loops.

---

## 16. Retry Rules

**Retryable** error codes (`error.retryable: true`):

- `upstream_timeout` (504)
- `upstream_unavailable` (502, 503)
- `rate_limited` (429) — after `Retry-After`
- `internal_error` (500)

**Non-retryable** (`error.retryable: false`):

- `bad_request` (400)
- `unauthorized` (401)
- `forbidden` (403)
- `not_found` (404)
- `unsupported_provider` (404)
- `validation_error` (422)

**Frontend policy (fixed):**

- Max 3 attempts total (1 initial + 2 retries).
- Exponential backoff with jitter: `min(2^attempt * 250ms, 4s) + rand(0..250ms)`.
- Honor `error.retryAfterMs` and `Retry-After` when present (they
  override backoff).
- Never retry non-idempotent verbs (none in v1).
- Circuit-break: after 5 consecutive `upstream_unavailable` on the same
  provider within 60 s, the frontend suspends that provider for 30 s
  and surfaces a soft error to the UI.

The backend SHOULD implement its own upstream retries invisibly, but
MUST still respect the per-request budget in §14.

---

## 17. HTTP Status Codes & Error Codes

| HTTP | `error.code`             | Meaning                                            | Retryable |
|------|--------------------------|----------------------------------------------------|-----------|
| 200  | —                        | OK                                                 | —         |
| 400  | `bad_request`            | Malformed query / missing required param           | no        |
| 401  | `unauthorized`           | Missing/invalid bearer token                       | no        |
| 403  | `forbidden`              | Token valid but not permitted for this provider    | no        |
| 404  | `not_found`              | Product/supplier confirmed missing upstream        | no        |
| 404  | `unsupported_provider`   | Provider path not enabled on this backend          | no        |
| 409  | `stale_cache`            | Only with `refresh=true` when refresh in progress  | yes       |
| 422  | `validation_error`       | Semantically invalid params (e.g. maxPrice<minPrice)| no       |
| 429  | `rate_limited`           | Bucket exceeded (see §15)                          | yes       |
| 500  | `internal_error`         | Unhandled server error                             | yes       |
| 502  | `upstream_unavailable`   | Upstream returned 5xx or unparseable data          | yes       |
| 503  | `service_unavailable`    | Backend maintenance / draining                     | yes       |
| 504  | `upstream_timeout`       | Upstream slower than budget in §14                 | yes       |

The backend MUST NOT return 200 with `ok: false`. HTTP status and
envelope status must always agree.

---

## 18. Cache Rules

Two cache layers:

### 18.1 Backend cache (authoritative)

The backend owns freshness. Recommended TTLs:

| Resource                 | TTL        | Stale-while-revalidate |
|--------------------------|------------|------------------------|
| Search results           | 10 min     | 30 min                 |
| Product detail           | 30 min     | 2 h                    |
| Product variants         | 15 min     | 1 h                    |
| Supplier detail          | 6 h        | 24 h                   |
| Categories               | 24 h       | 7 d                    |

Every 2xx response MUST include the `cache` object (see §4):

```json
"cache": { "hit": true, "ageSeconds": 42, "ttlSeconds": 600, "staleWhileRevalidateSeconds": 1800 }
```

And a matching HTTP `Cache-Control` header, e.g.:

```
Cache-Control: public, max-age=600, stale-while-revalidate=1800
ETag: "W/\"abc123\""
```

`refresh=true` bypasses the cache but is rate-limited (§15). The backend
MAY answer a `refresh=true` request from cache with HTTP `409
stale_cache` if a refresh is already in flight; the frontend will wait
and retry once.

### 18.2 Frontend cache

The frontend uses TanStack Query keyed by `(provider, endpoint, params)`.
It respects `cache.ttlSeconds` from the envelope as its `staleTime`. It
does NOT persist scraped data into its own database in v1 — the
`search_cache` and `sync_logs` tables are reserved for the future sync
job (not this backend).

---

## 19. Pagination

- Page-based, 1-indexed.
- `pageSize` bounds: `1 ≤ pageSize ≤ 60`. Values outside the bound MUST
  return `422 validation_error`.
- `meta.total` MAY be `null` if unknown. `meta.hasMore` MUST always be a
  boolean.
- `meta.nextPage` is convenience only; the frontend treats
  `hasMore === true` as the source of truth.
- Deep pagination (`page > 100`) MAY be rejected with `422
  validation_error` and `error.details.maxPage`.

---

## 20. Search Flow

```text
 UI (search route)
    │  useSuspenseQuery(["1688", "search", params])
    ▼
 catalogService.search(params)
    │
    ▼
 SourcingProvider (sourcing1688.provider.ts)
    │  fetch via server function only — Authorization stays server-side
    ▼
 createServerFn ── GET {BASE_URL}/v1/1688/search?...
    │
    ▼
 Scraper backend
    ├─ 1. auth check (bearer)                            → 401 on failure
    ├─ 2. validate params (Zod)                          → 400 / 422
    ├─ 3. rate-limit bucket                              → 429
    ├─ 4. cache lookup (fresh)                           → return with cache.hit=true
    ├─ 5. if stale & SWR window, return stale + refresh in background
    ├─ 6. else Playwright fetch upstream (budget §14)
    ├─ 7. normalize → SearchResultItem[]
    ├─ 8. persist to cache with TTL
    └─ 9. respond 200 envelope
```

Frontend behavior:

1. Debounces user input 250 ms.
2. Sends `X-Request-Id` per call.
3. Applies retry policy §16.
4. Never surfaces raw HTML or upstream error text to end users; maps
   `error.code` to a localized message.

---

## 21. Product Detail Flow

```text
 UI (product.$id route loader)
    │  ensureQueryData(["1688","product",id])
    ▼
 catalogService.getProduct(id)
    ▼
 SourcingProvider.getProduct(id)
    ▼
 createServerFn ── GET /v1/1688/product/:id
    ├─ backend: cache → Playwright fetch detail page
    │   → normalize → cache (TTL 30 min)
    ▼
 200 { data: ProductDetail, meta: {} }
    │
    ▼ (component mounts)
 If ProductDetail.variants is missing/empty AND the product has options:
    GET /v1/1688/product/:id/variants
    → merge into local view state
```

Rules:

- The frontend never assumes `variants` is present on `ProductDetail`.
- A 404 on the detail endpoint is a hard "not found" — the UI shows the
  404 page and does NOT retry.

---

## 22. Failure Flow

```text
 request
   │
   ▼
 non-2xx? ── no ──▶ deliver payload
   │ yes
   ▼
 error.retryable === true?
   │        │
   │        └── no ──▶ surface localized message (map error.code)
   │                    log requestId + error.code + details
   ▼ yes
 attempts < 3?
   │        │
   │        └── no ──▶ surface message + "Try again" affordance
   ▼ yes
 wait (retryAfterMs || Retry-After || backoff §16)
   ▼
 retry same request with same X-Request-Id? NO — mint a new one, keep a
 correlation header X-Retry-Of: <original-request-id>
   ▼
 back to top
```

The frontend classifies user-facing failures into three buckets:

1. **Transient** (retryable) — show inline spinner + retry, no toast.
2. **Not found** — dedicated empty state.
3. **Blocking** (auth/config) — full error boundary; ops must fix.

---

## 23. Security & Operational Requirements

- **TLS only.** Reject `http://` at the load balancer.
- **HSTS**, **secure headers** (`X-Content-Type-Options: nosniff`,
  `Referrer-Policy: no-referrer`, `Permissions-Policy` minimal).
- **Log hygiene:** never log the bearer token, cookies, or raw upstream
  session data. Always log `requestId`, `provider`, `path`, `status`,
  `error.code`, `durationMs`.
- **PII:** scraped data must not include buyer PII. Supplier public info
  is fine.
- **Robots / TOS:** compliance with each upstream's terms is the VPS
  operator's responsibility; the frontend enforces no policy here.
- **Token rotation:** the backend MUST accept two valid tokens during a
  rotation window (primary + previous). The frontend swaps its secret
  and redeploys within the window.
- **Health monitoring:** `/v1/health` polled every 30 s by an external
  uptime monitor; on-call alert threshold: 3 consecutive failures.

---

## 24. Environment Variables (frontend side)

Server-only secrets, read inside `createServerFn` handlers, never at
module scope:

| Variable                      | Purpose                                                |
|-------------------------------|--------------------------------------------------------|
| `SCRAPER_BACKEND_URL`         | Base URL incl. `/v1` prefix, e.g. `https://vps/v1`     |
| `SCRAPER_BACKEND_TOKEN`       | Bearer token issued by the VPS                         |
| `SCRAPER_HMAC_SECRET`         | Optional shared secret for `X-Signature` (§2)          |
| `SCRAPER_DEFAULT_TIMEOUT_MS`  | Optional override, default `8000`                      |
| `SCRAPER_MAX_RETRIES`         | Optional override, default `2`                         |

No client-visible (`VITE_*`) mirror exists for any of these.

---

## 25. Compatibility & Change Policy

- **Additive changes** (new optional fields, new optional query params,
  new endpoints) stay on `/v1`. The frontend ignores unknown fields.
- **Breaking changes** (renamed/removed fields, changed types, changed
  semantics, changed error codes) require `/v2` and a deprecation
  window of at least 30 days during which both versions are served.
- The frontend pins to a single version at build time via
  `SCRAPER_BACKEND_URL` (which already contains `/v1`).

---

## 26. Provider Coverage in v1

`1688` is the reference implementation. The identical shape MUST be
exposed for other providers under:

- `/v1/alibaba/…`
- `/v1/taobao/…`
- `/v1/aliexpress/…`

`/v1/health.providers` declares which are live. The frontend's provider
registry (`src/features/sourcing/providers/index.ts`) selects the active
one; it does not care which are enabled server-side beyond feature
detection via `/v1/health`.

---

## 27. Deliverables Checklist for the Backend

The VPS backend is considered v1-complete when all of the following are
true:

- [ ] `GET /v1/health` returns the shape in §6.
- [ ] `GET /v1/1688/search` returns items matching §7.5 and pagination §19.
- [ ] `GET /v1/1688/product/:id` returns §8.2 and correct 404s.
- [ ] `GET /v1/1688/product/:id/variants` returns §9.2.
- [ ] `GET /v1/1688/supplier/:id` (recommended) returns §10.
- [ ] All responses use the envelope in §4.
- [ ] Authentication (§2), rate limits (§15), timeouts (§14),
      cache headers (§18), and error codes (§17) match this spec.
- [ ] `refresh=true` works and is rate-limited.
- [ ] Images are HTTPS and stable (§12).
- [ ] All monetary values use `amountMinor` integers (§13).
- [ ] Load test: 50 rps sustained on `/v1/1688/search` for 5 min with
      p95 < 2 s (cache hit) / < 8 s (cache miss).

This document is the contract. The frontend will not accommodate
deviations — the backend must match this shape.
