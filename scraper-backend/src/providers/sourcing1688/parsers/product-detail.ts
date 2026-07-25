import type { Page } from "playwright";

/**
 * Product-detail parser for 1688 offer pages. Selectors are prioritized
 * and evaluated in the browser context so DOM lookups stay fast. Every
 * field is best-effort — never fabricate data. When a field is unknown,
 * the parser omits it and the route wraps whatever is available into
 * the spec's ProductDetail shape.
 */

export interface ParsedProductDetail {
  title: string;
  descriptionHtml: string;
  description: string;
  images: string[];
  priceDisplay: string;
  minOrderQty: number | null;
  stock: number | null;
  attributes: Record<string, string>;
  supplier: {
    name: string;
    url: string;
    verified: boolean;
    country: string;
  };
  shippingOrigin: string;
}

const TITLE_SELECTORS = [
  'h1.d-title',
  'h1[class*="title"]',
  'div[class*="offerTitle"] h1',
  'div[class*="offer-title"]',
  'div.title-text',
  'h1',
];

const GALLERY_SELECTORS = [
  'div[class*="detail-gallery"] img',
  'div[class*="mainPic"] img',
  'div.od-gallery img',
  'div[class*="preview"] img',
  'ul.tab-trigger img',
];

const PRICE_SELECTORS = [
  'div[class*="price-original"]',
  'div[class*="price-num"]',
  'div[class*="price-content"] span',
  'span[class*="price"]',
  'div[class*="mod-detail-price"]',
];

const MOQ_SELECTORS = [
  'div[class*="obj-amount"]',
  'div[class*="mod-detail-purchasing"] span',
  'div[class*="obj-basic"] span',
];

const SUPPLIER_NAME_SELECTORS = [
  'a[class*="company-name"]',
  'div[class*="company-name"]',
  'a[href*=".1688.com"][class*="name"]',
  'div[class*="seller"] a',
];

const SUPPLIER_LINK_SELECTORS = [
  'a[href*="//shop"][href*=".1688.com"]',
  'a[href*=".1688.com"][class*="company"]',
];

const DESCRIPTION_SELECTORS = [
  'div#desc-lazyload-container',
  'div[class*="content-detail"]',
  'div[class*="offer-detail"]',
  'div.mod-detail-description',
];

const ATTR_TABLE_SELECTORS = [
  'div[class*="offer-attr"] li',
  'div[class*="mod-detail-attributes"] li',
  'ul[class*="offer-attr"] li',
  'div[class*="od-pc-attribute"] li',
];

export async function extractProductDetail(page: Page): Promise<ParsedProductDetail> {
  return page.evaluate(
    (args: {
      titleSel: string[];
      gallerySel: string[];
      priceSel: string[];
      moqSel: string[];
      supplierNameSel: string[];
      supplierLinkSel: string[];
      descSel: string[];
      attrSel: string[];
    }) => {
      const {
        titleSel,
        gallerySel,
        priceSel,
        moqSel,
        supplierNameSel,
        supplierLinkSel,
        descSel,
        attrSel,
      } = args;

      const text = (el: Element | null | undefined): string =>
        (el?.textContent ?? "").replace(/\s+/g, " ").trim();
      const attr = (el: Element | null | undefined, n: string): string =>
        (el?.getAttribute(n) ?? "").trim();
      const pick = (list: readonly string[]): Element | null => {
        for (const s of list) {
          const el = document.querySelector(s);
          if (el && text(el)) return el;
        }
        return null;
      };
      const absUrl = (raw: string): string => {
        if (!raw) return "";
        if (raw.startsWith("//")) return "https:" + raw;
        if (raw.startsWith("/")) return "https://www.1688.com" + raw;
        return raw.replace(/^http:\/\//i, "https://");
      };

      // Title
      const titleEl = pick(titleSel);
      const title = text(titleEl) || document.title.replace(/[-_|].*$/, "").trim();

      // Gallery — dedupe by base filename, drop tiny sprites/analytics pixels
      const imgUrls = new Set<string>();
      for (const sel of gallerySel) {
        const imgs = Array.from(document.querySelectorAll(sel)) as HTMLImageElement[];
        for (const img of imgs) {
          const src =
            img.currentSrc ||
            attr(img, "src") ||
            attr(img, "data-src") ||
            attr(img, "data-lazy-src");
          if (!src) continue;
          const abs = absUrl(src);
          // Normalize alicdn size suffix ..._50x50.jpg → base
          const base = abs.replace(/_\d+x\d+(?:q\d+)?(\.(?:jpg|jpeg|png|webp))/i, "$1");
          if (/(spacer|1x1|pixel|blank\.gif)/i.test(base)) continue;
          imgUrls.add(base);
          if (imgUrls.size >= 20) break;
        }
        if (imgUrls.size > 0) break;
      }

      // Price
      const priceEl = pick(priceSel);
      const priceDisplay = text(priceEl);

      // MOQ
      const moqEl = pick(moqSel);
      const moqText = text(moqEl);
      const moqMatch = moqText.match(/(\d+)/);
      const minOrderQty = moqMatch ? Number.parseInt(moqMatch[1]!, 10) : null;

      // Attributes
      const attributes: Record<string, string> = {};
      for (const sel of attrSel) {
        const rows = Array.from(document.querySelectorAll(sel));
        for (const row of rows) {
          const raw = text(row);
          const [k, ...rest] = raw.split(/[:：]/);
          const v = rest.join(":").trim();
          if (k && v && k.length < 60 && v.length < 200) {
            attributes[k.trim()] = v;
          }
        }
        if (Object.keys(attributes).length > 0) break;
      }

      // Description (HTML best-effort — 1688 lazy-loads full description
      // in an iframe; the container is usually empty on first paint).
      let descriptionHtml = "";
      for (const sel of descSel) {
        const el = document.querySelector(sel);
        if (el && el.innerHTML.length > 0) {
          descriptionHtml = el.innerHTML;
          break;
        }
      }
      const description = descriptionHtml
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();

      // Supplier
      const supplierNameEl = pick(supplierNameSel);
      const supplierName = text(supplierNameEl);
      let supplierUrl = "";
      for (const s of supplierLinkSel) {
        const a = document.querySelector(s) as HTMLAnchorElement | null;
        if (a && a.href) {
          supplierUrl = a.href;
          break;
        }
      }
      // 1688 marks verified suppliers with a "诚信通" badge on the page.
      const bodyText = document.body?.textContent ?? "";
      const verified = /诚信通|实力商家|超级工厂|Verified Supplier/i.test(bodyText);

      // Origin — attributes usually contain "产地" (place of origin) key.
      const originKey = Object.keys(attributes).find((k) =>
        /产地|origin|发货地/i.test(k),
      );
      const shippingOrigin = originKey ? attributes[originKey] ?? "CN" : "CN";

      return {
        title,
        descriptionHtml,
        description,
        images: Array.from(imgUrls),
        priceDisplay,
        minOrderQty,
        stock: null, // 1688 obscures true stock behind SKU widget
        attributes,
        supplier: {
          name: supplierName,
          url: supplierUrl,
          verified,
          country: "CN",
        },
        shippingOrigin,
      };
    },
    {
      titleSel: TITLE_SELECTORS as unknown as string[],
      gallerySel: GALLERY_SELECTORS as unknown as string[],
      priceSel: PRICE_SELECTORS as unknown as string[],
      moqSel: MOQ_SELECTORS as unknown as string[],
      supplierNameSel: SUPPLIER_NAME_SELECTORS as unknown as string[],
      supplierLinkSel: SUPPLIER_LINK_SELECTORS as unknown as string[],
      descSel: DESCRIPTION_SELECTORS as unknown as string[],
      attrSel: ATTR_TABLE_SELECTORS as unknown as string[],
    },
  );
}
