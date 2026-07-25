import { supabase } from "@/integrations/supabase/client";
import type { ProductSummary } from "@/features/sourcing/domain/types";

export const wishlistService = {
  async list(): Promise<ProductSummary[]> {
    const { data, error } = await supabase
      .from("wishlist")
      .select("product_id, products(id, provider, external_id, slug, title, base_price_minor, currency_code, min_order_qty, rating, review_count, sales_count, product_images(url, is_primary))");
    if (error) throw error;
    return (data ?? [])
      .map((row: any) => row.products)
      .filter(Boolean)
      .map((p: any) => {
        const imgs = p.product_images ?? [];
        const primary = imgs.find((i: any) => i.is_primary)?.url ?? imgs[0]?.url;
        return {
          id: p.id, provider: p.provider, externalId: p.external_id, slug: p.slug ?? undefined,
          title: p.title, primaryImage: primary,
          price: { amountMinor: Number(p.base_price_minor), currency: p.currency_code },
          minOrderQty: p.min_order_qty, rating: p.rating ?? undefined,
          reviewCount: p.review_count, salesCount: p.sales_count,
        } satisfies ProductSummary;
      });
  },

  async add(productId: string) {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) throw new Error("Not signed in");
    const { error } = await supabase.from("wishlist").upsert(
      { user_id: u.user.id, product_id: productId },
      { onConflict: "user_id,product_id" },
    );
    if (error) throw error;
  },

  async remove(productId: string) {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    await supabase.from("wishlist").delete().eq("user_id", u.user.id).eq("product_id", productId);
  },
};
