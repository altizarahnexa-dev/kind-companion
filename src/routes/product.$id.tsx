import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Heart, ShoppingCart, Star } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { catalogService } from "@/features/sourcing/services/catalog.service";
import { cartService } from "@/features/cart/cart.service";
import { wishlistService } from "@/features/wishlist/wishlist.service";
import { useAuth } from "@/hooks/use-auth";
import { formatMoney } from "@/lib/format";

export const Route = createFileRoute("/product/$id")({
  head: ({ params }) => ({
    meta: [
      { title: `Product — Sourcely` },
      { name: "description", content: `Product details on Sourcely.` },
      { property: "og:title", content: `Product — Sourcely` },
      { property: "og:description", content: `Product details on Sourcely.` },
    ],
  }),
  component: ProductPage,
});

function ProductPage() {
  const { id } = Route.useParams();
  const { isAuthenticated } = useAuth();
  const qc = useQueryClient();

  const { data: product, isLoading } = useQuery({
    queryKey: ["product", id],
    queryFn: () => catalogService.getProduct(id),
  });

  const [selectedVariant, setSelectedVariant] = useState<string | null>(null);
  const [qty, setQty] = useState(1);
  const [activeImage, setActiveImage] = useState(0);

  const addToCart = useMutation({
    mutationFn: () => {
      if (!product) throw new Error("No product");
      return cartService.add(product.id, selectedVariant, qty);
    },
    onSuccess: () => { toast.success("Added to cart"); qc.invalidateQueries({ queryKey: ["cart"] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not add to cart"),
  });

  const addToWishlist = useMutation({
    mutationFn: () => wishlistService.add(product!.id),
    onSuccess: () => { toast.success("Added to wishlist"); qc.invalidateQueries({ queryKey: ["wishlist"] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not add"),
  });

  if (isLoading) return <AppShell><div className="container mx-auto p-8">Loading…</div></AppShell>;
  if (!product) return (
    <AppShell>
      <div className="container mx-auto p-8 text-center">
        <h1 className="text-2xl font-semibold">Product not found</h1>
        <Button asChild variant="link"><Link to="/">Return home</Link></Button>
      </div>
    </AppShell>
  );

  const currentPrice = selectedVariant
    ? product.variants.find((v) => v.id === selectedVariant)?.price ?? product.price
    : product.price;

  return (
    <AppShell>
      <div className="container mx-auto grid gap-8 px-4 py-6 lg:grid-cols-2">
        <div>
          <div className="aspect-square overflow-hidden rounded-lg bg-muted">
            {product.images[activeImage]?.url ? (
              <img src={product.images[activeImage].url} alt={product.title} className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full items-center justify-center text-muted-foreground">No image</div>
            )}
          </div>
          {product.images.length > 1 && (
            <div className="mt-3 flex gap-2 overflow-x-auto">
              {product.images.map((img, i) => (
                <button
                  key={i}
                  onClick={() => setActiveImage(i)}
                  aria-label={`View image ${i + 1}`}
                  className={`h-16 w-16 shrink-0 overflow-hidden rounded border-2 ${i === activeImage ? "border-primary" : "border-transparent"}`}
                >
                  <img src={img.url} alt="" className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-5">
          <div>
            <h1 className="text-2xl font-semibold">{product.title}</h1>
            <div className="mt-2 flex items-center gap-3 text-sm text-muted-foreground">
              {product.rating != null && (
                <span className="flex items-center gap-1">
                  <Star className="h-4 w-4 fill-current text-yellow-500" />
                  {product.rating.toFixed(1)} ({product.reviewCount} reviews)
                </span>
              )}
              {product.salesCount > 0 && <span>· {product.salesCount} sold</span>}
              {product.supplier?.verified && <Badge variant="secondary">Verified supplier</Badge>}
            </div>
          </div>

          <div className="text-3xl font-bold">{formatMoney(currentPrice.amountMinor, currentPrice.currency)}</div>
          {product.minOrderQty > 1 && (
            <p className="text-sm text-muted-foreground">Minimum order: {product.minOrderQty}</p>
          )}

          {product.variants.length > 0 && (
            <div>
              <h2 className="mb-2 text-sm font-semibold">Variants</h2>
              <div className="flex flex-wrap gap-2">
                {product.variants.map((v) => (
                  <button
                    key={v.id}
                    onClick={() => setSelectedVariant(v.id)}
                    className={`rounded-md border px-3 py-1.5 text-sm ${selectedVariant === v.id ? "border-primary bg-primary/10" : "border-input"}`}
                  >
                    {v.title ?? v.sku ?? Object.values(v.attributes).join(" / ")}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center gap-3">
            <label className="text-sm">Qty</label>
            <input
              type="number"
              min={product.minOrderQty}
              value={qty}
              onChange={(e) => setQty(Math.max(product.minOrderQty, Number(e.target.value)))}
              className="w-20 rounded-md border px-2 py-1"
              aria-label="Quantity"
            />
          </div>

          <div className="flex flex-wrap gap-3">
            <Button size="lg" disabled={!isAuthenticated || addToCart.isPending} onClick={() => addToCart.mutate()}>
              <ShoppingCart className="mr-2 h-4 w-4" /> Add to cart
            </Button>
            <Button size="lg" variant="outline" disabled={!isAuthenticated || addToWishlist.isPending} onClick={() => addToWishlist.mutate()}>
              <Heart className="mr-2 h-4 w-4" /> Save
            </Button>
            {!isAuthenticated && (
              <p className="w-full text-sm text-muted-foreground"><Link to="/auth" className="underline">Sign in</Link> to buy or save.</p>
            )}
          </div>

          {product.supplier && (
            <Card className="p-4">
              <h3 className="text-sm font-semibold">Supplier</h3>
              <Link to="/supplier/$id" params={{ id: product.supplier.slug ?? product.supplier.id }} className="mt-1 block hover:underline">
                {product.supplier.name}
              </Link>
              {product.supplier.country && <p className="text-xs text-muted-foreground">{product.supplier.country}</p>}
            </Card>
          )}

          {product.description && (
            <div>
              <h2 className="mb-2 text-sm font-semibold">Description</h2>
              <p className="whitespace-pre-line text-sm text-muted-foreground">{product.description}</p>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
