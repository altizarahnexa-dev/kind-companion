/**
 * Domain types for the sourcing marketplace.
 * These are the canonical shapes the UI consumes, decoupled from any
 * external provider's raw response. Provider adapters MUST map into these.
 */

export type ProviderCode =
  | "internal"
  | "alibaba"
  | "aliexpress"
  | "taobao"
  | "sourcing_1688";

export interface Money {
  /** Amount in minor units (e.g. cents). */
  amountMinor: number;
  currency: string;
}

export interface ProductImage {
  url: string;
  alt?: string;
  isPrimary?: boolean;
  position?: number;
}

export interface ProductVariant {
  id: string;
  sku?: string;
  title?: string;
  price: Money;
  stock: number;
  attributes: Record<string, string | number>;
  imageUrl?: string;
}

export interface SupplierSummary {
  id: string;
  provider: ProviderCode;
  externalId: string;
  name: string;
  slug?: string;
  logoUrl?: string;
  country?: string;
  city?: string;
  rating?: number;
  yearsActive?: number;
  verified: boolean;
}

export interface ProductSummary {
  id: string;
  provider: ProviderCode;
  externalId: string;
  slug?: string;
  title: string;
  primaryImage?: string;
  price: Money;
  minOrderQty: number;
  rating?: number;
  reviewCount: number;
  salesCount: number;
  supplier?: Pick<SupplierSummary, "id" | "name" | "country" | "verified">;
}

export interface ProductDetail extends ProductSummary {
  description?: string;
  images: ProductImage[];
  variants: ProductVariant[];
  tags: string[];
  attributes: Record<string, unknown>;
  categoryId?: string;
  supplier?: SupplierSummary;
}

export interface Category {
  id: string;
  parentId?: string | null;
  slug: string;
  name: string;
  description?: string;
  imageUrl?: string;
  children?: Category[];
}

export interface SearchFilters {
  query?: string;
  categoryId?: string;
  supplierId?: string;
  minPriceMinor?: number;
  maxPriceMinor?: number;
  currency?: string;
  sort?: "relevance" | "price_asc" | "price_desc" | "rating" | "sales";
  tags?: string[];
}

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
  error?: {
    code: string;
    message: string;
    retryable: boolean;
    status?: number;
    retryAfterMs?: number;
  };
}

export interface SearchRequest extends SearchFilters {
  page?: number;
  pageSize?: number;
}
