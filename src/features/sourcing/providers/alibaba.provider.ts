/**
 * Alibaba provider — STUB.
 * When you're ready to integrate, implement each method against Alibaba's
 * Open Platform API and map responses into the domain types. No other file
 * in the app needs to change.
 */
import type { Page, ProductSummary } from "../domain/types";
import { emptyPage, type SourcingProvider } from "./SourcingProvider";

export const alibabaProvider: SourcingProvider = {
  code: "alibaba",
  displayName: "Alibaba",
  async searchProducts(req) { return emptyPage<ProductSummary>(req) as Page<ProductSummary>; },
  async getProduct() { return null; },
  async listCategories() { return []; },
  async getSupplier() { return null; },
  async listSupplierProducts(_id, req) { return emptyPage<ProductSummary>(req); },
};
