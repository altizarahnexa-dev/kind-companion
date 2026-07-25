import type { Page } from "playwright";

/**
 * Search-results parser for 1688.
 *
 * All DOM selectors and DOM-to-domain mapping live here. Route handlers
 * MUST NOT contain any selector strings — when 1688 ships a redesign,
 * only this file changes.
 *
 * Phase 4.3: extract the first N (default 10) visible product cards from
 * the search results page. No product-page visits, no variants, no
 * translation, no persistence.
 */

export interface SearchResultProduct {
  external_id: string;
  title: string;
  product_url: string;
  thumbnail: string;
  displayed_price: string;
  supplier_name: string;
}

/**
 * Ordered list of candidate card containers. 1688 A/Bs their layout
 * (classic grid, "space-offer" cards, sponsored "p4p" cards). We try each
 * container selector and use the first one that yields non-empty results.
 */
const CARD_CONTAINER_SELECTORS: readonly string[] = [
  '[data-p4p-id]',
  '[data-offer-id]',
  'a.space-offer-card-box',
  'div.space-offer-card-box',
  'div.sm-offer-item',
  'div.grid-offer',
  'div.card-container',
  'div.offer-card-box',
];

/**
 * Sub-selectors used inside a single card. Each field has a prioritized
 * list; the first non-empty match wins. Keep lists small and specific —
 * broad regexes here cause cross-field bleed.
 */
const FIELD_SELECTORS = {
  link: [
    'a[href*="detail.1688.com/offer/"]',
    'a[href*="//detail.1688.com/"]',
    'a[href]',
  ],
  title: [
    '.mojar-element-title',
    '[class*="title"] [class*="text"]',
    '[class*="title"]',
    'a[title]',
    'img[alt]',
  ],
  thumbnail: [
    'img[src*="alicdn"]',
    'img[data-src*="alicdn"]',
    'img',
  ],
  price: [
    '.mojar-element-price',
    '[class*="showPricling"]',
    '[class*="price"] [class*="number"]',
    '[class*="price"]',
  ],
  supplier: [
    '[class*="company-name"]',
    '[class*="companyName"]',
    '[class*="supplier"]',
    '[class*="company"]',
    '[class*="shop-name"]',
  ],
} as const;

/** Regex that pulls the offer id out of a 1688 product URL. */
const OFFER_ID_RE = /\/offer\/(\d+)\.html/i;

/**
 * Extract up to `limit` product cards from the currently loaded results page.
 *
 * Returns `[]` if the page structure is unrecognizable — the caller is
 * responsible for turning that into a spec error envelope so the client
 * never receives fake data.
 */
export async function extractSearchResults(
  page: Page,
  limit = 10,
): Promise<SearchResultProduct[]> {
  return page.evaluate(
    (args: {
      containers: string[];
      fields: {
        link: string[];
        title: string[];
        thumbnail: string[];
        price: string[];
        supplier: string[];
      };
      offerIdSrc: string;
      cap: number;
    }) => {
      const { containers, fields, offerIdSrc, cap } = args;
      const OFFER_ID = new RegExp(offerIdSrc, "i");

      const text = (el: Element | null | undefined): string =>
        (el?.textContent ?? "").replace(/\s+/g, " ").trim();

      const attr = (el: Element | null | undefined, name: string): string =>
        (el?.getAttribute(name) ?? "").trim();

      const pick = (root: Element, list: readonly string[]): Element | null => {
        for (const sel of list) {
          const found = root.querySelector(sel);
          if (found) return found;
        }
        return null;
      };

      const absUrl = (raw: string): string => {
        if (!raw) return "";
        if (raw.startsWith("//")) return "https:" + raw;
        if (raw.startsWith("/")) return "https://www.1688.com" + raw;
        return raw;
      };

      // Pick the first container selector that returns matches.
      let cards: Element[] = [];
      for (const sel of containers) {
        const found = Array.from(document.querySelectorAll(sel));
        if (found.length > 0) {
          cards = found;
          break;
        }
      }

      const out: SearchResultProduct[] = [];
      for (const card of cards) {
        if (out.length >= cap) break;

        // Link + external_id (both required — drop card if missing).
        const linkEl = pick(card, fields.link) as HTMLAnchorElement | null;
        const rawHref = linkEl?.href || attr(linkEl, "href");
        const productUrl = absUrl(rawHref);
        const idMatch = productUrl.match(OFFER_ID);
        const externalId =
          idMatch?.[1] ??
          attr(card, "data-offer-id") ??
          attr(card, "data-p4p-id");
        if (!productUrl || !externalId) continue;

        // Title (required).
        const titleEl = pick(card, fields.title);
        const title =
          text(titleEl) ||
          attr(titleEl, "title") ||
          attr(titleEl, "alt");
        if (!title) continue;

        // Thumbnail.
        const imgEl = pick(card, fields.thumbnail) as HTMLImageElement | null;
        const thumbnail = absUrl(
          imgEl?.currentSrc ||
            attr(imgEl, "src") ||
            attr(imgEl, "data-src") ||
            attr(imgEl, "data-lazy-src"),
        );

        // Displayed price (raw string, no parsing — Phase 4.3 keeps it verbatim).
        const priceEl = pick(card, fields.price);
        const displayedPrice = text(priceEl);

        // Supplier name.
        const supplierEl = pick(card, fields.supplier);
        const supplierName = text(supplierEl);

        out.push({
          external_id: String(externalId),
          title,
          product_url: productUrl,
          thumbnail,
          displayed_price: displayedPrice,
          supplier_name: supplierName,
        });
      }
      return out;
    },
    {
      containers: CARD_CONTAINER_SELECTORS as unknown as string[],
      fields: FIELD_SELECTORS as unknown as {
        link: string[];
        title: string[];
        thumbnail: string[];
        price: string[];
        supplier: string[];
      },
      offerIdSrc: OFFER_ID_RE.source,
      cap: limit,
    },
  );
}
