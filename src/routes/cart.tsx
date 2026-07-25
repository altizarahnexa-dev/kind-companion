import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cartService } from "@/features/cart/cart.service";
import { useAuth } from "@/hooks/use-auth";
import { formatMoney } from "@/lib/format";

export const Route = createFileRoute("/cart")({
  head: () => ({
    meta: [
      { title: "Your cart — Sourcely" },
      { name: "description", content: "Review the items in your Sourcely cart before checkout." },
      { property: "og:title", content: "Your cart — Sourcely" },
      { property: "og:description", content: "Review the items in your Sourcely cart before checkout." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: CartPage,
});

function CartPage() {
  const { isAuthenticated, loading } = useAuth();
  const qc = useQueryClient();

  const cart = useQuery({
    queryKey: ["cart"],
    queryFn: () => cartService.list(),
    enabled: isAuthenticated,
  });

  const updateQty = useMutation({
    mutationFn: ({ id, quantity }: { id: string; quantity: number }) => cartService.updateQuantity(id, quantity),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cart"] }),
  });
  const remove = useMutation({
    mutationFn: (id: string) => cartService.remove(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["cart"] }); toast.success("Removed"); },
  });

  if (loading) return <AppShell><div className="container mx-auto p-8">Loading…</div></AppShell>;
  if (!isAuthenticated) {
    return (
      <AppShell>
        <div className="container mx-auto max-w-md p-8 text-center">
          <h1 className="text-2xl font-semibold">Sign in to view your cart</h1>
          <Button asChild className="mt-4"><Link to="/auth">Sign in</Link></Button>
        </div>
      </AppShell>
    );
  }

  const items = cart.data ?? [];
  const total = items.reduce((sum, i) => sum + (i.product?.priceMinor ?? 0) * i.quantity, 0);
  const currency = items[0]?.product?.currency ?? "USD";

  return (
    <AppShell>
      <div className="container mx-auto px-4 py-6">
        <h1 className="mb-6 text-2xl font-semibold">Your cart</h1>
        {items.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-muted-foreground">Your cart is empty.</p>
            <Button asChild className="mt-4"><Link to="/search">Continue shopping</Link></Button>
          </div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
            <div className="space-y-3">
              {items.map((item) => (
                <Card key={item.id} className="flex gap-4 p-4">
                  {item.product?.primaryImage && (
                    <img src={item.product.primaryImage} alt="" className="h-24 w-24 rounded object-cover" />
                  )}
                  <div className="flex-1">
                    <Link to="/product/$id" params={{ id: item.productId }} className="font-medium hover:underline">
                      {item.product?.title ?? "Product"}
                    </Link>
                    <div className="mt-2 flex items-center gap-3">
                      <input
                        type="number"
                        min={1}
                        value={item.quantity}
                        onChange={(e) => updateQty.mutate({ id: item.id, quantity: Math.max(1, Number(e.target.value)) })}
                        className="w-20 rounded-md border px-2 py-1"
                        aria-label="Quantity"
                      />
                      <Button variant="ghost" size="sm" onClick={() => remove.mutate(item.id)}>
                        <Trash2 className="mr-1 h-4 w-4" /> Remove
                      </Button>
                    </div>
                  </div>
                  {item.product && (
                    <div className="text-right font-semibold">
                      {formatMoney((item.product.priceMinor) * item.quantity, item.product.currency)}
                    </div>
                  )}
                </Card>
              ))}
            </div>
            <Card className="h-fit p-6">
              <h2 className="mb-4 font-semibold">Summary</h2>
              <div className="flex justify-between border-t pt-4 text-lg font-semibold">
                <span>Total</span>
                <span>{formatMoney(total, currency)}</span>
              </div>
              <Button className="mt-4 w-full" size="lg">Checkout</Button>
              <p className="mt-2 text-xs text-muted-foreground">Checkout will be wired to your payment provider.</p>
            </Card>
          </div>
        )}
      </div>
    </AppShell>
  );
}
