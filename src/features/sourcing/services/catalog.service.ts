/**
 * Catalog service — the ONLY thing UI/components import for catalog data.
 * It delegates to the active provider so pages never depend on a provider.
 */
import { getProvider } from "../providers";
import type {
  Category,
  Page,
  ProductDetail,
  ProductSummary,
  SearchRequest,
  SupplierSummary,
} from "../domain/types";

export const catalogService = {
  searchProducts(req: SearchRequest): Promise<Page<ProductSummary>> {
    return getProvider().searchProducts(req);
  },
  getProduct(id: string): Promise<ProductDetail | null> {
    return getProvider().getProduct(id);
  },
  listCategories(): Promise<Category[]> {
    return getProvider().listCategories();
  },
  getSupplier(id: string): Promise<SupplierSummary | null> {
    return getProvider().getSupplier(id);
  },
  listSupplierProducts(supplierId: string, req: SearchRequest) {
    return getProvider().listSupplierProducts(supplierId, req);
  },
};
