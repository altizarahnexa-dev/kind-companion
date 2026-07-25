import type { Page, ProductSummary } from "../domain/types";
import { emptyPage, type SourcingProvider } from "./SourcingProvider";

export const aliexpressProvider: SourcingProvider = {
  code: "aliexpress",
  displayName: "AliExpress",
  async searchProducts(req) { return emptyPage<ProductSummary>(req) as Page<ProductSummary>; },
  async getProduct() { return null; },
  async listCategories() { return []; },
  async getSupplier() { return null; },
  async listSupplierProducts(_id, req) { return emptyPage<ProductSummary>(req); },
};
