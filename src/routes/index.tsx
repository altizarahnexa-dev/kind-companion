import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Globe, ShieldCheck, Truck } from "lucide-react";

import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ProductGrid } from "@/components/product/product-grid";
import { catalogService } from "@/features/sourcing/services/catalog.service";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Sourcely — Global Sourcing Marketplace" },
      { name: "description", content: "Source millions of products from verified suppliers worldwide. Compare prices across 1688, Alibaba, Taobao and AliExpress in one place." },
      { property: "og:title", content: "Sourcely — Global Sourcing Marketplace" },
      { property: "og:description", content: "Source millions of products from verified suppliers worldwide." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: HomePage,
});

function HomePage() {
  const { data: trending, isLoading } = useQuery({
    queryKey: ["home", "trending"],
    queryFn: () => catalogService.searchProducts({ sort: "sales", pageSize: 10 }),
  });
  const { data: categories } = useQuery({
    queryKey: ["home", "categories"],
    queryFn: () => catalogService.listCategories(),
  });

  return (
    <AppShell>
      <section className="border-b bg-gradient-to-br from-primary/10 via-background to-background">
        <div className="container mx-auto px-4 py-16 md:py-24">
          <div className="max-w-3xl">
            <h1 className="text-4xl font-bold tracking-tight md:text-6xl">
              Source anything, from anywhere.
            </h1>
            <p className="mt-4 text-lg text-muted-foreground md:text-xl">
              Millions of products. Thousands of verified suppliers. One unified marketplace.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button asChild size="lg">
                <Link to="/search">Start browsing <ArrowRight className="ml-2 h-4 w-4" /></Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link to="/categories">Explore categories</Link>
              </Button>
            </div>
          </div>
        </div>
      </section>

      <section className="container mx-auto px-4 py-12">
        <div className="grid gap-4 md:grid-cols-3">
          <Card className="p-6"><Globe className="mb-3 h-6 w-6 text-primary" /><h3 className="font-semibold">Global reach</h3><p className="text-sm text-muted-foreground">Suppliers across 200+ countries.</p></Card>
          <Card className="p-6"><ShieldCheck className="mb-3 h-6 w-6 text-primary" /><h3 className="font-semibold">Verified suppliers</h3><p className="text-sm text-muted-foreground">Trust scores and quality checks.</p></Card>
          <Card className="p-6"><Truck className="mb-3 h-6 w-6 text-primary" /><h3 className="font-semibold">Fast logistics</h3><p className="text-sm text-muted-foreground">Track every shipment end-to-end.</p></Card>
        </div>
      </section>

      {categories && categories.length > 0 && (
        <section className="container mx-auto px-4 py-8">
          <h2 className="mb-6 text-2xl font-semibold">Shop by category</h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-6">
            {categories.slice(0, 12).map((c) => (
              <Link key={c.id} to="/category/$slug" params={{ slug: c.slug }} className="group">
                <Card className="flex aspect-square flex-col items-center justify-center p-4 text-center transition-colors group-hover:bg-accent">
                  <span className="text-sm font-medium">{c.name}</span>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="container mx-auto px-4 py-12">
        <div className="mb-6 flex items-end justify-between">
          <h2 className="text-2xl font-semibold">Trending now</h2>
          <Button asChild variant="ghost" size="sm"><Link to="/search">View all</Link></Button>
        </div>
        <ProductGrid
          products={trending?.items ?? []}
          loading={isLoading}
          emptyMessage="Catalogue is empty. Connect a sourcing provider to populate it."
        />
      </section>
    </AppShell>
  );
}
