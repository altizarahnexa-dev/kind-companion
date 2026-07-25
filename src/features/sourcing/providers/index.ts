/**
 * PROVIDER REGISTRY — the single switch point for the active sourcing provider.
 *
 * To switch or add a provider:
 *   1. Add its file next to this one and export a `SourcingProvider`.
 *   2. Register it in `PROVIDERS` below.
 *   3. Change `ACTIVE_PROVIDER` (or set the VITE_SOURCING_PROVIDER env var).
 *
 * No other file in the app should import a specific provider directly.
 */
import type { ProviderCode } from "../domain/types";
import type { SourcingProvider } from "./SourcingProvider";
import { internalProvider } from "./internal.provider";
import { alibabaProvider } from "./alibaba.provider";
import { aliexpressProvider } from "./aliexpress.provider";
import { taobaoProvider } from "./taobao.provider";
import { sourcing1688Provider } from "./sourcing1688.provider";

export const PROVIDERS: Record<ProviderCode, SourcingProvider> = {
  internal: internalProvider,
  alibaba: alibabaProvider,
  aliexpress: aliexpressProvider,
  taobao: taobaoProvider,
  sourcing_1688: sourcing1688Provider,
};

const ENV_PROVIDER =
  (import.meta.env.VITE_SOURCING_PROVIDER as ProviderCode | undefined) ?? undefined;

export const ACTIVE_PROVIDER: ProviderCode = ENV_PROVIDER ?? "internal";

export function getProvider(code: ProviderCode = ACTIVE_PROVIDER): SourcingProvider {
  return PROVIDERS[code] ?? internalProvider;
}
