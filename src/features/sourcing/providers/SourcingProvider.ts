/**
 * SourcingProvider — the single interface every external marketplace
 * (1688, Alibaba, Taobao, AliExpress, …) must implement.
 *
 * Adding a new provider = one new file that implements this interface,
 * plus one line in ./index.ts to register it. No other code changes.
 */
import type {
  Category,
  Page,
  ProductDetail,
  ProductSummary,
  ProviderCode,
  SearchRequest,
  SupplierSummary,
} from "../domain/types";

export interface SourcingProvider {
  readonly code: ProviderCode;
  readonly displayName: string;

  searchProducts(req: SearchRequest): Promise<Page<ProductSummary>>;
  getProduct(id: string): Promise<ProductDetail | null>;
  listCategories(): Promise<Category[]>;
  getSupplier(id: string): Promise<SupplierSummary | null>;
  listSupplierProducts(
    supplierId: string,
    req: SearchRequest,
  ): Promise<Page<ProductSummary>>;
}

/** Standard empty page — providers use this until wired to a real backend. */
export function emptyPage<T>(req: SearchRequest = {}): Page<T> {
  return {
    items: [],
    page: req.page ?? 1,
    pageSize: req.pageSize ?? 24,
    total: 0,
    hasMore: false,
  };
}
