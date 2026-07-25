import type { Page, ProductSummary } from "../domain/types";
import { emptyPage, type SourcingProvider } from "./SourcingProvider";

export const sourcing1688Provider: SourcingProvider = {
  code: "sourcing_1688",
  displayName: "1688",
  async searchProducts(req) { return emptyPage<ProductSummary>(req) as Page<ProductSummary>; },
  async getProduct() { return null; },
  async listCategories() { return []; },
  async getSupplier() { return null; },
  async listSupplierProducts(_id, req) { return emptyPage<ProductSummary>(req); },
};
