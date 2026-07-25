/**
 * Cart service — thin, replaceable layer over Supabase.
 * UI never calls Supabase directly for cart operations.
 */
import { supabase } from "@/integrations/supabase/client";

export interface CartItem {
  id: string;
  productId: string;
  variantId: string | null;
  quantity: number;
  product?: {
    title: string;
    primaryImage?: string;
    priceMinor: number;
    currency: string;
  };
}

export const cartService = {
  async list(): Promise<CartItem[]> {
    const { data, error } = await supabase
      .from("cart")
      .select("id, product_id, variant_id, quantity, products(title, base_price_minor, currency_code, product_images(url, is_primary))")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data ?? []).map((row: any) => {
      const imgs = row.products?.product_images ?? [];
      const primary = imgs.find((i: any) => i.is_primary)?.url ?? imgs[0]?.url;
      return {
        id: row.id,
        productId: row.product_id,
        variantId: row.variant_id,
        quantity: row.quantity,
        product: row.products ? {
          title: row.products.title,
          primaryImage: primary,
          priceMinor: Number(row.products.base_price_minor),
          currency: row.products.currency_code,
        } : undefined,
      };
    });
  },

  async add(productId: string, variantId: string | null, quantity = 1) {
    const { data: user } = await supabase.auth.getUser();
    if (!user.user) throw new Error("Not signed in");
    const { error } = await supabase.from("cart").upsert(
      { user_id: user.user.id, product_id: productId, variant_id: variantId, quantity },
      { onConflict: "user_id,product_id,variant_id" },
    );
    if (error) throw error;
  },

  async updateQuantity(id: string, quantity: number) {
    const { error } = await supabase.from("cart").update({ quantity }).eq("id", id);
    if (error) throw error;
  },

  async remove(id: string) {
    const { error } = await supabase.from("cart").delete().eq("id", id);
    if (error) throw error;
  },

  async clear() {
    const { data: user } = await supabase.auth.getUser();
    if (!user.user) return;
    await supabase.from("cart").delete().eq("user_id", user.user.id);
  },
};
