import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { ProductGrid } from "@/components/product/product-grid";
import { wishlistService } from "@/features/wishlist/wishlist.service";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/wishlist")({
  head: () => ({
    meta: [
      { title: "Wishlist — Sourcely" },
      { name: "description", content: "Products you've saved for later." },
      { property: "og:title", content: "Wishlist — Sourcely" },
      { property: "og:description", content: "Products you've saved for later." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: WishlistPage,
});

function WishlistPage() {
  const { isAuthenticated, loading } = useAuth();
  const wishlist = useQuery({
    queryKey: ["wishlist"],
    queryFn: () => wishlistService.list(),
    enabled: isAuthenticated,
  });

  if (loading) return <AppShell><div className="container mx-auto p-8">Loading…</div></AppShell>;
  if (!isAuthenticated) {
    return (
      <AppShell>
        <div className="container mx-auto max-w-md p-8 text-center">
          <h1 className="text-2xl font-semibold">Sign in to view your wishlist</h1>
          <Button asChild className="mt-4"><Link to="/auth">Sign in</Link></Button>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="container mx-auto px-4 py-6">
        <h1 className="mb-6 text-2xl font-semibold">Wishlist</h1>
        <ProductGrid
          products={wishlist.data ?? []}
          loading={wishlist.isLoading}
          emptyMessage="Your wishlist is empty."
        />
      </div>
    </AppShell>
  );
}
