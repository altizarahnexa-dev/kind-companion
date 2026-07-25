/**
 * Internal provider — reads from our own Supabase-backed catalogue.
 * This is the default while external providers are not wired.
 *
 * All queries respect RLS: public read policies on products/images/etc.
 */
import { supabase } from "@/integrations/supabase/client";
import type {
  Category,
  Page,
  ProductDetail,
  ProductImage,
  ProductSummary,
  ProductVariant,
  SearchRequest,
  SupplierSummary,
} from "../domain/types";
import { emptyPage, type SourcingProvider } from "./SourcingProvider";

type ProductRow = {
  id: string;
  provider: string;
  external_id: string;
  slug: string | null;
  title: string;
  description: string | null;
  base_price_minor: number;
  currency_code: string;
  min_order_qty: number;
  rating: number | null;
  review_count: number;
  sales_count: number;
  tags: string[];
  attributes: Record<string, unknown>;
  category_id: string | null;
  supplier_id: string | null;
};

function toSummary(
  row: ProductRow,
  primaryImage?: string,
  supplier?: Pick<SupplierSummary, "id" | "name" | "country" | "verified">,
): ProductSummary {
  return {
    id: row.id,
    provider: row.provider as ProductSummary["provider"],
    externalId: row.external_id,
    slug: row.slug ?? undefined,
    title: row.title,
    primaryImage,
    price: { amountMinor: Number(row.base_price_minor), currency: row.currency_code },
    minOrderQty: row.min_order_qty,
    rating: row.rating ?? undefined,
    reviewCount: row.review_count,
    salesCount: row.sales_count,
    supplier,
  };
}

export const internalProvider: SourcingProvider = {
  code: "internal",
  displayName: "Internal Catalogue",

  async searchProducts(req: SearchRequest): Promise<Page<ProductSummary>> {
    const page = req.page ?? 1;
    const pageSize = req.pageSize ?? 24;
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    let q = supabase
      .from("products")
      .select("*, product_images(url, is_primary, position), suppliers(id, name, country, verified)", {
        count: "exact",
      })
      .eq("is_active", true);

    if (req.query) q = q.ilike("title", `%${req.query}%`);
    if (req.categoryId) q = q.eq("category_id", req.categoryId);
    if (req.supplierId) q = q.eq("supplier_id", req.supplierId);
    if (req.minPriceMinor != null) q = q.gte("base_price_minor", req.minPriceMinor);
    if (req.maxPriceMinor != null) q = q.lte("base_price_minor", req.maxPriceMinor);

    switch (req.sort) {
      case "price_asc": q = q.order("base_price_minor", { ascending: true }); break;
      case "price_desc": q = q.order("base_price_minor", { ascending: false }); break;
      case "rating": q = q.order("rating", { ascending: false, nullsFirst: false }); break;
      case "sales": q = q.order("sales_count", { ascending: false }); break;
      default: q = q.order("created_at", { ascending: false });
    }

    const { data, count, error } = await q.range(from, to);
    if (error) throw error;

    const items: ProductSummary[] = (data ?? []).map((row: any) => {
      const imgs = (row.product_images ?? []) as Array<{ url: string; is_primary: boolean; position: number }>;
      const primary =
        imgs.find((i) => i.is_primary)?.url ??
        [...imgs].sort((a, b) => a.position - b.position)[0]?.url;
      const s = row.suppliers;
      return toSummary(row, primary, s ? { id: s.id, name: s.name, country: s.country, verified: s.verified } : undefined);
    });

    const total = count ?? items.length;
    return { items, page, pageSize, total, hasMore: from + items.length < total };
  },

  async getProduct(id: string): Promise<ProductDetail | null> {
    const { data, error } = await supabase
      .from("products")
      .select("*, product_images(*), product_variants(*), suppliers(*)")
      .or(`id.eq.${id},slug.eq.${id}`)
      .eq("is_active", true)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;

    const images: ProductImage[] = ((data as any).product_images ?? [])
      .map((i: any) => ({ url: i.url, alt: i.alt ?? undefined, isPrimary: i.is_primary, position: i.position }))
      .sort((a: ProductImage, b: ProductImage) => (a.position ?? 0) - (b.position ?? 0));
    const variants: ProductVariant[] = ((data as any).product_variants ?? []).map((v: any) => ({
      id: v.id, sku: v.sku ?? undefined, title: v.title ?? undefined,
      price: { amountMinor: Number(v.price_minor), currency: v.currency_code },
      stock: v.stock, attributes: v.attributes ?? {}, imageUrl: v.image_url ?? undefined,
    }));
    const s = (data as any).suppliers;
    const supplier: SupplierSummary | undefined = s ? {
      id: s.id, provider: s.provider, externalId: s.external_id, name: s.name,
      slug: s.slug ?? undefined, logoUrl: s.logo_url ?? undefined, country: s.country ?? undefined,
      city: s.city ?? undefined, rating: s.rating ?? undefined, yearsActive: s.years_active ?? undefined,
      verified: s.verified,
    } : undefined;

    const base = toSummary(data as ProductRow, images.find((i) => i.isPrimary)?.url ?? images[0]?.url, supplier);
    return {
      ...base,
      description: (data as any).description ?? undefined,
      images, variants,
      tags: (data as any).tags ?? [],
      attributes: (data as any).attributes ?? {},
      categoryId: (data as any).category_id ?? undefined,
      supplier,
    };
  },

  async listCategories(): Promise<Category[]> {
    const { data, error } = await supabase
      .from("categories")
      .select("*")
      .eq("is_active", true)
      .order("sort_order", { ascending: true });
    if (error) throw error;
    const rows = (data ?? []) as any[];
    const byId = new Map<string, Category>();
    rows.forEach((r) => byId.set(r.id, {
      id: r.id, parentId: r.parent_id, slug: r.slug, name: r.name,
      description: r.description ?? undefined, imageUrl: r.image_url ?? undefined, children: [],
    }));
    const roots: Category[] = [];
    byId.forEach((c) => {
      if (c.parentId && byId.has(c.parentId)) byId.get(c.parentId)!.children!.push(c);
      else roots.push(c);
    });
    return roots;
  },

  async getSupplier(id: string): Promise<SupplierSummary | null> {
    const { data, error } = await supabase
      .from("suppliers").select("*")
      .or(`id.eq.${id},slug.eq.${id}`).maybeSingle();
    if (error) throw error;
    if (!data) return null;
    const s = data as any;
    return {
      id: s.id, provider: s.provider, externalId: s.external_id, name: s.name,
      slug: s.slug ?? undefined, logoUrl: s.logo_url ?? undefined, country: s.country ?? undefined,
      city: s.city ?? undefined, rating: s.rating ?? undefined, yearsActive: s.years_active ?? undefined,
      verified: s.verified,
    };
  },

  async listSupplierProducts(supplierId, req) {
    return this.searchProducts({ ...req, supplierId });
  },
};

export { emptyPage };
