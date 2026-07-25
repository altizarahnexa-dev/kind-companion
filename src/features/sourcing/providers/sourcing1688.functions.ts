/**
 * Server function wrappers for the 1688 provider. Thin RPC layer only —
 * runtime logic lives in `./sourcing1688.server.ts`.
 *
 * These functions execute on the server; the client bundle receives an RPC
 * stub, so SCRAPER_BACKEND_TOKEN is never exposed to the browser.
 */
import { createServerFn } from "@tanstack/react-start";
import type { Page, ProductSummary, SearchRequest } from "../domain/types";

export const searchProducts1688Fn = createServerFn({ method: "GET" })
  .inputValidator((input: SearchRequest): SearchRequest => input ?? {})
  .handler(async ({ data }): Promise<Page<ProductSummary>> => {
    const { searchProducts1688Safe } = await import(
      "./sourcing1688.server"
    );
    return searchProducts1688Safe(data);
  });
