import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { z } from "zod";

import { AppShell } from "@/components/layout/app-shell";
import { ProductGrid } from "@/components/product/product-grid";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useInfiniteScroll } from "@/hooks/use-infinite-scroll";
import { catalogService } from "@/features/sourcing/services/catalog.service";

const searchSchema = z.object({
  q: z.string().optional(),
  sort: z.enum(["relevance", "price_asc", "price_desc", "rating", "sales"]).optional(),
});

export const Route = createFileRoute("/search")({
  validateSearch: searchSchema,
  head: () => ({
    meta: [
      { title: "Search products — Sourcely" },
      { name: "description", content: "Search the global sourcing catalogue for millions of products from verified suppliers." },
      { property: "og:title", content: "Search products — Sourcely" },
      { property: "og:description", content: "Search millions of products from verified suppliers." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SearchPage,
});

function SearchPage() {
  const { q, sort } = Route.useSearch();
  const navigate = useNavigate();

  const query = useInfiniteQuery({
    queryKey: ["search", q ?? "", sort ?? "relevance"],
    initialPageParam: 1,
    queryFn: ({ pageParam }) => catalogService.searchProducts({ query: q, sort, page: pageParam, pageSize: 50 }),
    getNextPageParam: (last) => (last.hasMore ? last.page + 1 : undefined),
  });

  const products = useMemo(() => query.data?.pages.flatMap((p) => p.items) ?? [], [query.data]);
  const total = query.data?.pages[0]?.total ?? 0;
  const providerError = query.data?.pages.find((page) => page.error)?.error;
  const errorMessage = providerError?.message ?? (query.error instanceof Error ? query.error.message : "The active sourcing provider is unavailable.");
  const hasProviderError = Boolean(providerError) || query.isError;

  const sentinelRef = useInfiniteScroll(
    () => { if (query.hasNextPage && !query.isFetchingNextPage) query.fetchNextPage(); },
    !!query.hasNextPage,
  );

  return (
    <AppShell>
      <div className="container mx-auto px-4 py-6">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <h1 className="text-2xl font-semibold">
            {q ? <>Results for “{q}”</> : "All products"}
            {total > 0 && <span className="ml-2 text-sm font-normal text-muted-foreground">({total})</span>}
          </h1>
          <Select
            value={sort ?? "relevance"}
            onValueChange={(v) => navigate({ to: "/search", search: (s: z.infer<typeof searchSchema>) => ({ ...s, sort: v as z.infer<typeof searchSchema>["sort"] }) })}
          >
            <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="relevance">Most relevant</SelectItem>
              <SelectItem value="sales">Best selling</SelectItem>
              <SelectItem value="rating">Top rated</SelectItem>
              <SelectItem value="price_asc">Price: low to high</SelectItem>
              <SelectItem value="price_desc">Price: high to low</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {!hasProviderError && <ProductGrid products={products} loading={query.isLoading} />}

        {hasProviderError && products.length === 0 && (
          <Alert variant="destructive" className="mt-6">
            <AlertTitle>Search provider unavailable</AlertTitle>
            <AlertDescription>
              <p>{errorMessage}</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => void query.refetch()}
              >
                Retry search
              </Button>
            </AlertDescription>
          </Alert>
        )}

        <div ref={sentinelRef} className="h-16" aria-hidden />
        {query.isFetchingNextPage && (
          <p className="py-6 text-center text-sm text-muted-foreground">Loading more…</p>
        )}
        {!query.hasNextPage && products.length > 0 && (
          <p className="py-6 text-center text-sm text-muted-foreground">End of results</p>
        )}
        {products.length === 0 && !query.isLoading && !hasProviderError && (
          <div className="py-16 text-center">
            <p className="text-muted-foreground">No products yet. Connect a sourcing provider to populate the catalogue.</p>
            <Button asChild variant="link"><a href="/">Back home</a></Button>
          </div>
        )}
      </div>
    </AppShell>
  );
}
