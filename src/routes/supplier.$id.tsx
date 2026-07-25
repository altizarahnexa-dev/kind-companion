import { createFileRoute, Link } from "@tanstack/react-router";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";

import { AppShell } from "@/components/layout/app-shell";
import { ProductGrid } from "@/components/product/product-grid";
import { useInfiniteScroll } from "@/hooks/use-infinite-scroll";
import { catalogService } from "@/features/sourcing/services/catalog.service";

export const Route = createFileRoute("/supplier/$id")({
  head: () => ({
    meta: [
      { title: "Supplier — Sourcely" },
      { name: "description", content: "Supplier profile and full product catalogue." },
      { property: "og:title", content: "Supplier — Sourcely" },
      { property: "og:description", content: "Supplier profile and full product catalogue." },
    ],
  }),
  component: SupplierPage,
});

function SupplierPage() {
  const { id } = Route.useParams();
  const supplier = useQuery({
    queryKey: ["supplier", id],
    queryFn: () => catalogService.getSupplier(id),
  });

  const productsQuery = useInfiniteQuery({
    queryKey: ["supplier-products", supplier.data?.id ?? id],
    initialPageParam: 1,
    enabled: !!supplier.data?.id,
    queryFn: ({ pageParam }) =>
      catalogService.listSupplierProducts(supplier.data!.id, { page: pageParam, pageSize: 24 }),
    getNextPageParam: (last) => (last.hasMore ? last.page + 1 : undefined),
  });

  const products = productsQuery.data?.pages.flatMap((p) => p.items) ?? [];
  const sentinelRef = useInfiniteScroll(
    () => { if (productsQuery.hasNextPage && !productsQuery.isFetchingNextPage) productsQuery.fetchNextPage(); },
    !!productsQuery.hasNextPage,
  );

  if (supplier.isLoading) return <AppShell><div className="container mx-auto p-8">Loading…</div></AppShell>;
  if (!supplier.data) return (
    <AppShell>
      <div className="container mx-auto p-8 text-center">
        <h1 className="text-2xl font-semibold">Supplier not found</h1>
        <Link to="/" className="underline">Return home</Link>
      </div>
    </AppShell>
  );

  const s = supplier.data;

  return (
    <AppShell>
      <div className="container mx-auto px-4 py-6">
        <div className="mb-8 flex items-center gap-4">
          {s.logoUrl && <img src={s.logoUrl} alt="" className="h-16 w-16 rounded-full object-cover" />}
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-semibold">{s.name}</h1>
              {s.verified && <Badge variant="secondary">Verified</Badge>}
            </div>
            <p className="text-sm text-muted-foreground">
              {[s.city, s.country].filter(Boolean).join(", ")}
              {s.yearsActive != null && ` · ${s.yearsActive} years active`}
            </p>
          </div>
        </div>

        <h2 className="mb-4 text-lg font-semibold">Products</h2>
        <ProductGrid products={products} loading={productsQuery.isLoading} />
        <div ref={sentinelRef} className="h-16" aria-hidden />
      </div>
    </AppShell>
  );
}
