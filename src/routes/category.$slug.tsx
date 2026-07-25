import { createFileRoute } from "@tanstack/react-router";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { AppShell } from "@/components/layout/app-shell";
import { ProductGrid } from "@/components/product/product-grid";
import { useInfiniteScroll } from "@/hooks/use-infinite-scroll";
import { catalogService } from "@/features/sourcing/services/catalog.service";

export const Route = createFileRoute("/category/$slug")({
  head: ({ params }) => ({
    meta: [
      { title: `${params.slug} — Sourcely` },
      { name: "description", content: `Browse ${params.slug} products from verified global suppliers.` },
      { property: "og:title", content: `${params.slug} — Sourcely` },
      { property: "og:description", content: `Browse ${params.slug} products from verified global suppliers.` },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CategoryPage,
});

function CategoryPage() {
  const { slug } = Route.useParams();

  const { data: categories } = useQuery({
    queryKey: ["categories"],
    queryFn: () => catalogService.listCategories(),
  });
  const category = useMemo(() => {
    function find(list: any[] | undefined): any | undefined {
      if (!list) return;
      for (const c of list) {
        if (c.slug === slug) return c;
        const nested = find(c.children);
        if (nested) return nested;
      }
    }
    return find(categories);
  }, [categories, slug]);

  const query = useInfiniteQuery({
    queryKey: ["category", category?.id ?? slug],
    initialPageParam: 1,
    enabled: !!category,
    queryFn: ({ pageParam }) =>
      catalogService.searchProducts({ categoryId: category!.id, page: pageParam, pageSize: 24 }),
    getNextPageParam: (last) => (last.hasMore ? last.page + 1 : undefined),
  });

  const products = query.data?.pages.flatMap((p) => p.items) ?? [];
  const sentinelRef = useInfiniteScroll(
    () => { if (query.hasNextPage && !query.isFetchingNextPage) query.fetchNextPage(); },
    !!query.hasNextPage,
  );

  return (
    <AppShell>
      <div className="container mx-auto px-4 py-6">
        <h1 className="text-3xl font-semibold">{category?.name ?? slug}</h1>
        {category?.description && <p className="mt-2 text-muted-foreground">{category.description}</p>}
        <div className="mt-8">
          <ProductGrid products={products} loading={query.isLoading || !category} />
          <div ref={sentinelRef} className="h-16" aria-hidden />
          {query.isFetchingNextPage && <p className="py-6 text-center text-sm text-muted-foreground">Loading more…</p>}
        </div>
      </div>
    </AppShell>
  );
}
