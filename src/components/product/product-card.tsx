import { Link } from "@tanstack/react-router";
import { Star } from "lucide-react";

import type { ProductSummary } from "@/features/sourcing/domain/types";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatMoney } from "@/lib/format";

export function ProductCard({ product }: { product: ProductSummary }) {
  return (
    <Link to="/product/$id" params={{ id: product.slug ?? product.id }} className="group">
      <Card className="overflow-hidden transition-all hover:shadow-lg">
        <div className="aspect-square overflow-hidden bg-muted">
          {product.primaryImage ? (
            <img
              src={product.primaryImage}
              alt={product.title}
              loading="lazy"
              className="h-full w-full object-cover transition-transform group-hover:scale-105"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-muted-foreground text-sm">No image</div>
          )}
        </div>
        <div className="p-3 space-y-2">
          <h3 className="line-clamp-2 text-sm font-medium leading-snug">{product.title}</h3>
          <div className="flex items-baseline gap-2">
            <span className="text-lg font-semibold">{formatMoney(product.price.amountMinor, product.price.currency)}</span>
            {product.minOrderQty > 1 && (
              <span className="text-xs text-muted-foreground">MOQ {product.minOrderQty}</span>
            )}
          </div>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <div className="flex items-center gap-1">
              {product.rating != null && (
                <>
                  <Star className="h-3 w-3 fill-current text-yellow-500" aria-hidden />
                  <span>{product.rating.toFixed(1)}</span>
                </>
              )}
              {product.salesCount > 0 && <span>· {product.salesCount} sold</span>}
            </div>
            {product.supplier?.verified && <Badge variant="secondary" className="text-[10px]">Verified</Badge>}
          </div>
        </div>
      </Card>
    </Link>
  );
}

export function ProductCardSkeleton() {
  return (
    <Card className="overflow-hidden">
      <div className="aspect-square animate-pulse bg-muted" />
      <div className="p-3 space-y-2">
        <div className="h-4 animate-pulse rounded bg-muted" />
        <div className="h-4 w-1/2 animate-pulse rounded bg-muted" />
      </div>
    </Card>
  );
}
