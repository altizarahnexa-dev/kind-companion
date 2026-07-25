# ARCHITECTURE.md

Baseline architecture for the global sourcing marketplace. This document
freezes the current structure. It is the reference every future change
(providers, cart, orders, admin, dark mode, Playwright scrapers) must
respect.

Stack: **TanStack Start v1** (React 19 + Vite 7 + SSR), **TypeScript**,
**Tailwind v4**, **shadcn/ui**, **Supabase** (Postgres + Auth + Storage,
via Lovable Cloud).

> Do NOT migrate to Next.js. Do NOT bypass the provider interface.
> Do NOT import a specific provider from UI code.

---

## 1. Folder Structure

```text
src/
  routes/                      # TanStack file-based routes (pages only)
    __root.tsx                 # Root layout + <Outlet/>
    index.tsx                  # Home
    search.tsx                 # Search results
    categories.tsx             # Category index
    category.$slug.tsx         # Category detail
    product.$id.tsx            # Product detail
    supplier.$id.tsx           # Supplier detail
    cart.tsx                   # Cart page (UI only, no logic yet)
    wishlist.tsx               # Wishlist page
    orders.tsx                 # Orders page (UI only)
    account.tsx                # Account
    auth.tsx                   # Sign in / sign up
    api/                       # (reserved) server routes for webhooks / public APIs

  components/
    layout/                    # AppShell, SiteHeader, SiteFooter
    product/                   # ProductCard, ProductGrid, skeletons
    ui/                        # shadcn primitives

  features/                    # Business logic, grouped by bounded context
    sourcing/                  # Catalog / search / suppliers (provider-backed)
      domain/types.ts          # Canonical domain types (UI contract)
      providers/
        SourcingProvider.ts    # The interface every provider implements
        index.ts               # PROVIDER REGISTRY — single switch point
        internal.provider.ts   # Supabase-backed provider (default)
        alibaba.provider.ts    # Stub
        aliexpress.provider.ts # Stub
        taobao.provider.ts     # Stub
        sourcing1688.provider.ts # Stub
      services/
        catalog.service.ts     # UI-facing façade over the active provider
    cart/cart.service.ts
    wishlist/wishlist.service.ts
    orders/order.service.ts
    currency/currency.service.ts

  hooks/                       # Reusable hooks (infinite scroll, etc.)
  integrations/supabase/       # Auto-generated Supabase client + types (DO NOT EDIT)
  lib/                         # Pure helpers (format, utils, error capture)
  styles.css                   # Tailwind v4 tokens + theme
  router.tsx                   # Router setup
  start.ts                     # TanStack Start bootstrap
  server.ts                    # SSR entry

supabase/
  migrations/                  # SQL migrations (source of truth for schema)
```

**Layering rule (top imports bottom, never reverse):**

```text
routes ─▶ components ─▶ features/*/services ─▶ features/sourcing/providers ─▶ integrations/supabase
                                     │
                                     └─▶ features/*/domain (types only)
```

UI never imports `integrations/supabase` or a specific `*.provider.ts`
directly. Services never import routes or components.

---

## 2. Data Flow

```text
 ┌──────────┐   props    ┌────────────┐  call   ┌──────────────┐  call   ┌───────────────┐  SQL / HTTP   ┌────────┐
 │  Route   │──────────▶ │ Component  │───────▶ │  *.service   │───────▶ │  Provider     │──────────────▶│ Source │
 │  (page)  │            │  (view)    │         │  (façade)    │         │  (adapter)    │               │  (DB / │
 └──────────┘            └────────────┘         └──────────────┘         └───────────────┘               │  API)  │
        ▲                                                                        │                       └────────┘
        │                                     Canonical domain types             │
        └────────────────────────────────────────────────────────────────────────┘
```

- Pages read data through **services** (e.g. `catalogService.search(...)`).
- Services delegate to the **active provider** returned by `getProvider()`.
- Providers translate their raw upstream shape into **domain types**
  (`ProductSummary`, `ProductDetail`, `SupplierSummary`, `Category`,
  `Page<T>`, `Money`).
- Anything downstream of the provider boundary (SQL, REST, scrapers) is
  invisible to the UI.

Reads should be wrapped with TanStack Query (`ensureQueryData` in loaders +
`useSuspenseQuery` in components) as they are wired page-by-page.

---

## 3. Provider Flow

```text
                     ┌──────────────────────────┐
   catalog.service ──▶  getProvider(ACTIVE)     │
                     │                          │
                     │   PROVIDERS registry     │
                     │  ┌────────────────────┐  │
                     │  │ internal (default) │  │
                     │  │ alibaba            │  │
                     │  │ aliexpress         │  │
                     │  │ taobao             │  │
                     │  │ sourcing_1688      │  │
                     │  └────────────────────┘  │
                     └───────────┬──────────────┘
                                 │  implements
                                 ▼
                       SourcingProvider interface
                    (searchProducts, getProduct,
                     listCategories, getSupplier,
                     listSupplierProducts)
```

The interface is the contract. A provider that satisfies it is
drop-in replaceable.

### How to replace the provider in ONE place

Only `src/features/sourcing/providers/index.ts` decides which provider
is active.

1. Create `src/features/sourcing/providers/myvendor.provider.ts` and
   export a `const myvendorProvider: SourcingProvider = { … }`.
2. Register it in the `PROVIDERS` map in `providers/index.ts`.
3. Either:
   - set `VITE_SOURCING_PROVIDER=myvendor` in `.env`, or
   - change the fallback `ACTIVE_PROVIDER` constant.

No route, component, service, hook, or query needs to change. Any file
that imports a specific `*.provider.ts` outside the registry is a bug.

---

## 4. Search Flow

```text
 /search?q=&category=&page=
        │
        ▼
 Route loader ──▶ catalogService.search(req)
                        │
                        ▼
                 provider.searchProducts(req: SearchRequest)
                        │
             ┌──────────┴──────────┐
             ▼                     ▼
     internal provider       external provider
     (Supabase query)        (HTTP → map → domain)
             │                     │
             └──────────┬──────────┘
                        ▼
              Page<ProductSummary>
                        │
                        ▼
             ProductGrid + infinite scroll
```

`SearchRequest` fields: `q`, `categoryId`/`categorySlug`, `supplierId`,
`sort`, `page`, `pageSize`, `currency`, `filters`. Providers must accept
the shape and ignore fields they cannot honour.

---

## 5. Cache Flow

Two layers, both optional and provider-agnostic:

```text
 UI ──▶ TanStack Query cache (client, per session)
             │  miss
             ▼
        service call
             │
             ▼
     provider.searchProducts()
             │
             ├─▶ (internal) direct Supabase read
             │
             └─▶ (external) HTTP fetch ──▶ writes into `search_cache`
                                             (key = hash(provider,q,filters,page))
```

- **Client cache:** TanStack Query — keys must include the provider code
  so switching providers cannot serve stale cross-provider data
  (`["products", providerCode, req]`).
- **Server cache:** `public.search_cache` table — external providers
  persist normalized responses keyed by `(provider, query_hash)` with a
  TTL. The internal provider does not use it.
- **Invalidation:** `sync_logs` records background refreshes; a
  successful sync bumps `search_cache.updated_at` or deletes stale rows.

---

## 6. Database Schema

Source of truth: `supabase/migrations/*`. Tables in `public`:

| Table              | Purpose                                                       |
|--------------------|---------------------------------------------------------------|
| `profiles`         | User profile, 1:1 with `auth.users`                           |
| `user_roles`       | Role assignments (`buyer`, `admin`) — never on `profiles`     |
| `currencies`       | Supported currencies + FX rates (multi-currency ready)        |
| `categories`       | Hierarchical taxonomy (`parent_id`, `slug`)                   |
| `suppliers`        | Normalized supplier records, per provider                     |
| `products`         | Normalized product records (`provider`, `external_id`)        |
| `product_images`   | Ordered images per product                                    |
| `product_variants` | SKUs, price, stock, attributes                                |
| `wishlist`         | `(user_id, product_id)`                                       |
| `cart`             | User cart lines (variant + qty)                               |
| `orders`           | Order header                                                  |
| `order_items`      | Order lines                                                   |
| `search_cache`     | Cached provider responses (`provider`, `query_hash`, payload) |
| `sync_logs`        | Background sync runs (provider, status, counts, error)        |

**Invariants:**

- Every product/supplier row carries `(provider, external_id)` and a
  unique index on that pair.
- RLS is enabled on every table; `has_role(auth.uid(), 'admin')` gates
  privileged writes. Buyers can only read/write their own cart, wishlist,
  and orders.
- Every `public` table has explicit `GRANT`s to `authenticated` /
  `service_role` (and `anon` where public reads are allowed).
- Roles live only in `user_roles` (never on `profiles`).

---

## 7. API Routes

App-internal server logic uses **`createServerFn`** from
`@tanstack/react-start` (not Supabase Edge Functions).

External HTTP callers use **TanStack server routes** under
`src/routes/api/`:

| Path prefix           | Auth                | Use                                    |
|-----------------------|---------------------|----------------------------------------|
| `src/routes/api/*`    | Site auth applies   | Internal HTTP endpoints                |
| `src/routes/api/public/*` | Bypasses site auth | Webhooks, cron, provider sync callbacks |

Currently no server routes are shipped — the folder is reserved. Future
provider syncs will land under `src/routes/api/public/sync/$provider.ts`
with HMAC verification inside the handler.

Client → server RPC (typed):

```ts
// src/features/sourcing/rpc/search.functions.ts (future)
export const searchProducts = createServerFn({ method: "GET" })
  .inputValidator(SearchRequestSchema.parse)
  .handler(async ({ data }) => catalogService.search(data));
```

---

## 8. Environment Variables

Client-visible (must be `VITE_` prefixed):

| Variable                       | Purpose                                        |
|--------------------------------|------------------------------------------------|
| `VITE_SUPABASE_URL`            | Supabase project URL (auto-generated)          |
| `VITE_SUPABASE_PUBLISHABLE_KEY`| Supabase anon/publishable key (auto-generated) |
| `VITE_SUPABASE_PROJECT_ID`     | Project id (auto-generated)                    |
| `VITE_SOURCING_PROVIDER`       | Active provider code (default `internal`)      |
| `VITE_DEFAULT_CURRENCY`        | Default display currency (default `USD`)       |

Server-only (read **inside** handlers, never at module scope):

| Variable                    | Purpose                                    |
|-----------------------------|--------------------------------------------|
| `SUPABASE_SERVICE_ROLE_KEY` | Admin-only server writes                   |
| `LOVABLE_API_KEY`           | Lovable AI Gateway                         |
| `PROVIDER_1688_API_KEY`     | (future) 1688 sync                         |
| `PROVIDER_ALIBABA_API_KEY`  | (future) Alibaba sync                      |
| `PROVIDER_ALIEXPRESS_API_KEY` | (future)                                 |
| `PROVIDER_TAOBAO_API_KEY`   | (future)                                   |
| `SYNC_WEBHOOK_SECRET`       | HMAC secret for `/api/public/sync/*`       |
| `PLAYWRIGHT_WORKER_TOKEN`   | Shared secret for the scraper worker       |

Auto-generated Supabase files (`src/integrations/supabase/*`, `.env`
Supabase entries, `supabase/config.toml`) are read-only.

---

## 9. How to Replace the Provider (Checklist)

1. **Write the adapter.** New file in
   `src/features/sourcing/providers/`. Implement every method of
   `SourcingProvider`. Map upstream fields into the domain types in
   `features/sourcing/domain/types.ts`. Never leak upstream shapes.
2. **Register.** Add one line to the `PROVIDERS` map in
   `providers/index.ts`.
3. **Activate.** Set `VITE_SOURCING_PROVIDER=<code>` (or update the
   fallback in `providers/index.ts`).
4. **Cache keys.** Nothing to change — provider code is already part of
   `search_cache.query_hash` and the TanStack Query keys.
5. **Verify boundary.** `rg "from .*providers/(?!index)"` from `src/`
   must return zero hits outside the registry.

That is the entire surface area of a provider swap.

---

## 10. Future Playwright Backend Integration Points

The scraper is **not** built yet. When it is, it plugs in at these
well-defined seams — no UI change required.

```text
 Playwright worker (Node, out-of-process)
        │  scrapes 1688 / Alibaba / Taobao / AliExpress
        ▼
 POST /api/public/sync/$provider    ← src/routes/api/public/sync/$provider.ts
   • Verifies HMAC (SYNC_WEBHOOK_SECRET / PLAYWRIGHT_WORKER_TOKEN)
   • Validates payload with Zod
   • Upserts into: products, product_images, product_variants,
                   suppliers, categories
   • Writes a row to sync_logs
   • Invalidates matching rows in search_cache
        │
        ▼
 Internal provider (Supabase) now serves the fresh data
        │
        ▼
 External provider adapter (optional): calls the same worker via HTTP for
 live search, writes results into search_cache with a TTL
```

Integration points to preserve:

1. **`src/routes/api/public/sync/$provider.ts`** — the only ingress for
   scraped data. Signature verification lives here.
2. **`sync_logs`** — every worker run writes one row (`provider`,
   `status`, `items_upserted`, `error`, timestamps).
3. **`search_cache`** — live-search responses are cached here, keyed by
   `(provider, query_hash)` with TTL.
4. **`SourcingProvider`** — the worker never bypasses this interface;
   any read path exposed to the UI still goes through a provider
   adapter.
5. **Domain types** — the worker output must be mapped into the same
   `ProductSummary` / `ProductDetail` / `SupplierSummary` shapes; no
   upstream field names in the database.

---

## 11. Non-Goals for This Baseline

Deliberately deferred (do not implement without an explicit request):

- Admin dashboard
- Cart checkout / order placement logic (pages exist, wiring does not)
- Dark mode
- Real provider connections (1688, Alibaba, Taobao, AliExpress)
- Playwright worker itself

The scaffolding above is the contract these features will slot into.
