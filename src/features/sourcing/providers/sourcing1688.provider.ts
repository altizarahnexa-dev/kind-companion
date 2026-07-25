/**
 * 1688 provider — talks to the self-hosted Scraper Backend via a
 * server function. No fetch, no secrets, no scraping in this file.
 *
 * The `SourcingProvider` interface is unchanged; catalogService keeps
 * calling the same methods.
 */
import type { Page, ProductSummary } from "../domain/types";
import { emptyPage, type SourcingProvider } from "./SourcingProvider";
import { searchProducts1688Fn } from "./sourcing1688.functions";

export const sourcing1688Provider: SourcingProvider = {
  code: "sourcing_1688",
  displayName: "1688",

  async searchProducts(req) {
    return (await searchProducts1688Fn({ data: req })) as Page<ProductSummary>;
  },

  // Not implemented in this phase — return safe empties so the UI stays intact.
  async getProduct() {
    return null;
  },
  async listCategories() {
    return [];
  },
  async getSupplier() {
    return null;
  },
  async listSupplierProducts(_id, req) {
    return emptyPage<ProductSummary>(req);
  },
};
