import type { ProductSummary } from "@/features/sourcing/domain/types";
import { ProductCard, ProductCardSkeleton } from "./product-card";

export function ProductGrid({
  products,
  loading,
  skeletonCount = 8,
  emptyMessage = "No products found.",
}: {
  products: ProductSummary[];
  loading?: boolean;
  skeletonCount?: number;
  emptyMessage?: string;
}) {
  if (loading && products.length === 0) {
    return (
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {Array.from({ length: skeletonCount }).map((_, i) => <ProductCardSkeleton key={i} />)}
      </div>
    );
  }
  if (products.length === 0) {
    return <p className="py-16 text-center text-muted-foreground">{emptyMessage}</p>;
  }
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
      {products.map((p) => <ProductCard key={p.id} product={p} />)}
    </div>
  );
}
