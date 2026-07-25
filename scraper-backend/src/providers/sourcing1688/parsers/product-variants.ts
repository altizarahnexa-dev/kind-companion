import type { Page } from "playwright";

/**
 * Product-variants parser for 1688 offer pages.
 *
 * 1688 exposes SKUs through two channels:
 *   1. A "sku" widget on the DOM with grouped option chips.
 *   2. An embedded JSON blob (window.__INIT_DATA__ / data-* attrs) that
 *      the widget hydrates from.
 *
 * We prefer the JSON path (stable across CSS redesigns) and fall back
 * to DOM scraping. Returns an empty array when the product has no
 * configurable SKUs — the spec allows `variants: []` for those.
 */

export interface ParsedVariant {
  externalId: string;
  sku: string;
  title: string;
  attributes: Record<string, string>;
  priceDisplay: string;
  amountMinor: number | null;
  currency: "CNY";
  stock: number | null;
  image: string;
  available: boolean;
}

export interface ParsedVariantSet {
  options: Array<{ name: string; values: string[] }>;
  variants: ParsedVariant[];
}

export async function extractProductVariants(page: Page): Promise<ParsedVariantSet> {
  return page.evaluate((): ParsedVariantSet => {
    const abs = (raw: string): string => {
      if (!raw) return "";
      if (raw.startsWith("//")) return "https:" + raw;
      if (raw.startsWith("/")) return "https://www.1688.com" + raw;
      return raw.replace(/^http:\/\//i, "https://");
    };

    // --- Path A: window.__INIT_DATA__ / GLOBAL_DATA style blob ------------
    // 1688 detail pages hydrate from a global. Names vary by A/B; we
    // sniff the most common ones. Everything is best-effort — if we
    // can't find a recognizable shape we drop through to DOM parsing.
    const g = window as unknown as Record<string, unknown>;
    const candidateKeys = [
      "__INIT_DATA__",
      "__GLOBAL_DATA__",
      "runParams",
      "DetailData",
      "offerData",
    ];
    let skuBlob: unknown = null;
    for (const k of candidateKeys) {
      const v = g[k];
      if (v && typeof v === "object") {
        skuBlob = v;
        break;
      }
    }

    const variantsA: ParsedVariant[] = [];
    const optionsMap = new Map<string, Set<string>>();

    const walk = (node: unknown, depth = 0) => {
      if (!node || depth > 6) return;
      if (Array.isArray(node)) {
        for (const item of node) walk(item, depth + 1);
        return;
      }
      if (typeof node !== "object") return;
      const obj = node as Record<string, unknown>;
      // Heuristic: an object that has both a sku id and a price counts.
      const skuId =
        (obj["specId"] as string | undefined) ??
        (obj["skuId"] as string | undefined) ??
        (obj["id"] as string | undefined);
      const priceValue =
        (obj["price"] as string | number | undefined) ??
        (obj["discountPrice"] as string | number | undefined);
      const specAttrs =
        (obj["specAttrs"] as string | undefined) ??
        (obj["saleAttr"] as string | undefined) ??
        (obj["specName"] as string | undefined);
      if (skuId && (priceValue !== undefined) && specAttrs) {
        const attrParts = String(specAttrs).split(/[,;、]/).map((s) => s.trim()).filter(Boolean);
        const attributes: Record<string, string> = {};
        for (const p of attrParts) {
          const [k, ...rest] = p.split(/[:：]/);
          if (!k) continue;
          const val = rest.join(":").trim() || p;
          const key = rest.length > 0 ? k.trim() : "Option";
          attributes[key] = val;
          if (!optionsMap.has(key)) optionsMap.set(key, new Set());
          optionsMap.get(key)!.add(val);
        }
        const priceNum = Number.parseFloat(String(priceValue));
        const amountMinor = Number.isFinite(priceNum) ? Math.round(priceNum * 100) : null;
        const stockRaw = obj["canBookCount"] ?? obj["stock"] ?? obj["amountOnSale"];
        const stockNum = typeof stockRaw === "number" ? stockRaw : Number.parseInt(String(stockRaw ?? ""), 10);
        variantsA.push({
          externalId: String(skuId),
          sku: (obj["specId"] as string) ?? String(skuId),
          title: attrParts.join(" / "),
          attributes,
          priceDisplay: `¥${Number.isFinite(priceNum) ? priceNum.toFixed(2) : String(priceValue)}`,
          amountMinor,
          currency: "CNY",
          stock: Number.isFinite(stockNum) ? stockNum : null,
          image: abs((obj["imageUrl"] as string) ?? (obj["skuImageUrl"] as string) ?? ""),
          available: (Number.isFinite(stockNum) ? stockNum > 0 : true),
        });
      }
      for (const v of Object.values(obj)) walk(v, depth + 1);
    };
    if (skuBlob) walk(skuBlob);

    if (variantsA.length > 0) {
      return {
        options: Array.from(optionsMap.entries()).map(([name, values]) => ({
          name,
          values: Array.from(values),
        })),
        variants: variantsA,
      };
    }

    // --- Path B: DOM chip widget -----------------------------------------
    const optionRoots = Array.from(
      document.querySelectorAll(
        'div[class*="sku-prop"], div[class*="prop-item"], div[class*="od-pc-sku-item"]',
      ),
    );
    const options: Array<{ name: string; values: string[] }> = [];
    for (const root of optionRoots) {
      const labelEl = root.querySelector('[class*="prop-name"], [class*="title"], [class*="label"]');
      const name = (labelEl?.textContent ?? "").replace(/[:：\s]+$/g, "").trim();
      if (!name) continue;
      const values = Array.from(
        root.querySelectorAll('[class*="prop-value"] [class*="item"], li[class*="prop"] span, button, a'),
      )
        .map((v) => (v.textContent ?? "").trim())
        .filter((v) => v && v.length < 60);
      const dedup = Array.from(new Set(values));
      if (dedup.length > 0) options.push({ name, values: dedup });
    }
    return { options, variants: [] };
  });
}
