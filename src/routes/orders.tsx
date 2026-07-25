import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { orderService } from "@/features/orders/order.service";
import { useAuth } from "@/hooks/use-auth";
import { formatMoney } from "@/lib/format";

export const Route = createFileRoute("/orders")({
  head: () => ({
    meta: [
      { title: "Your orders — Sourcely" },
      { name: "description", content: "Track your Sourcely orders." },
      { property: "og:title", content: "Your orders — Sourcely" },
      { property: "og:description", content: "Track your Sourcely orders." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: OrdersPage,
});

function OrdersPage() {
  const { isAuthenticated, loading } = useAuth();
  const orders = useQuery({
    queryKey: ["orders"],
    queryFn: () => orderService.listMine(),
    enabled: isAuthenticated,
  });

  if (loading) return <AppShell><div className="container mx-auto p-8">Loading…</div></AppShell>;
  if (!isAuthenticated) {
    return (
      <AppShell>
        <div className="container mx-auto max-w-md p-8 text-center">
          <h1 className="text-2xl font-semibold">Sign in to view your orders</h1>
          <Button asChild className="mt-4"><Link to="/auth">Sign in</Link></Button>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="container mx-auto px-4 py-6">
        <h1 className="mb-6 text-2xl font-semibold">Orders</h1>
        {orders.isLoading && <p className="text-muted-foreground">Loading…</p>}
        {orders.data && orders.data.length === 0 && (
          <div className="py-16 text-center">
            <p className="text-muted-foreground">You haven't placed any orders yet.</p>
          </div>
        )}
        <div className="space-y-3">
          {orders.data?.map((o) => (
            <Card key={o.id} className="flex items-center justify-between p-4">
              <div>
                <div className="font-semibold">{o.orderNumber}</div>
                <div className="text-sm text-muted-foreground">
                  {new Date(o.createdAt).toLocaleDateString()} · {o.itemCount} item{o.itemCount === 1 ? "" : "s"}
                </div>
              </div>
              <div className="flex items-center gap-4">
                <Badge variant="secondary">{o.status}</Badge>
                <div className="font-semibold">{formatMoney(o.totalMinor, o.currency)}</div>
              </div>
            </Card>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
