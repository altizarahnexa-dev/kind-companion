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
    const { searchProducts1688, SourcingBackendError } = await import(
      "./sourcing1688.server"
    );
    try {
      return await searchProducts1688(data);
    } catch (err) {
      if (err instanceof SourcingBackendError) {
        // Re-throw as a plain Error carrying the code so the RPC boundary
        // preserves the message. The client SourcingProvider maps this to
        // its domain-level error surface.
        const wrapped = new Error(err.message);
        (wrapped as Error & { code?: string; status?: number; retryable?: boolean }).code = err.code;
        (wrapped as Error & { code?: string; status?: number; retryable?: boolean }).status = err.status;
        (wrapped as Error & { code?: string; status?: number; retryable?: boolean }).retryable = err.retryable;
        throw wrapped;
      }
      throw err;
    }
  });
