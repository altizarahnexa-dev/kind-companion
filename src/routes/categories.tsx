import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { AppShell } from "@/components/layout/app-shell";
import { Card } from "@/components/ui/card";
import { catalogService } from "@/features/sourcing/services/catalog.service";

export const Route = createFileRoute("/categories")({
  head: () => ({
    meta: [
      { title: "All categories — Sourcely" },
      { name: "description", content: "Browse every category on Sourcely — from apparel to electronics to industrial equipment." },
      { property: "og:title", content: "All categories — Sourcely" },
      { property: "og:description", content: "Browse every category on Sourcely." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CategoriesPage,
});

function CategoriesPage() {
  const { data: categories, isLoading } = useQuery({
    queryKey: ["categories"],
    queryFn: () => catalogService.listCategories(),
  });

  return (
    <AppShell>
      <div className="container mx-auto px-4 py-8">
        <h1 className="mb-6 text-3xl font-semibold">Categories</h1>
        {isLoading && <p className="text-muted-foreground">Loading…</p>}
        {!isLoading && (categories?.length ?? 0) === 0 && (
          <p className="text-muted-foreground">No categories yet.</p>
        )}
        <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
          {categories?.map((c) => (
            <Link key={c.id} to="/category/$slug" params={{ slug: c.slug }}>
              <Card className="p-4 transition-colors hover:bg-accent">
                <h2 className="font-semibold">{c.name}</h2>
                {c.description && <p className="mt-1 text-sm text-muted-foreground line-clamp-2">{c.description}</p>}
                {c.children && c.children.length > 0 && (
                  <p className="mt-2 text-xs text-muted-foreground">{c.children.length} subcategories</p>
                )}
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
