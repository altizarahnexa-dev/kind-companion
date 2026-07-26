/**
 * Demo catalog — deterministic fake product data for the "shoes" and
 * "backpacks" verticals. Used while the live 1688 scraper is offline so
 * the marketplace UI can be exercised end-to-end (search, pagination,
 * infinite scroll) without hitting any external service.
 *
 * Data is generated once, cached in memory, and persisted to
 * /data/cache/<category>.json for inspection.
 */
import { promises as fs } from "node:fs";
import path from "node:path";

export interface DemoItem {
  id: string;
  provider: "1688";
  externalId: string;
  url: string;
  title: string;
  primaryImage: { url: string; width: number; height: number };
  price: { amountMinor: number; currency: "CNY"; display: string };
  minOrderQty: number;
  rating: number;
  reviewCount: number;
  salesCount: number;
  supplier: {
    id: string;
    externalId: string;
    name: string;
    country: "CN";
    verified: boolean;
  };
  shipping: { originCountry: "CN"; originCity: string };
  description: string;
  specifications: Record<string, string>;
  tags: string[];
  fetchedAt: string;
}

type Category = "shoes" | "backpacks";

const CACHE_ROOT_CANDIDATES = ["/data/cache", path.resolve(process.cwd(), "data/cache")];

// -- Deterministic PRNG ------------------------------------------------------

function mulberry32(seed: number) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = t;
    r = Math.imul(r ^ (r >>> 15), r | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)]!;
}

function randInt(rng: () => number, min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}

// -- Vocabularies ------------------------------------------------------------

const SHOE_BRANDS = [
  "Feiyue", "Warrior", "Anta", "Li-Ning", "Peak", "361°", "Xtep", "Erke",
  "Double Star", "Kaiway", "Onemix", "Rax", "Camel", "Toread", "Merrell-CN",
];
const SHOE_TYPES = [
  "Running Shoes", "Sneakers", "Canvas Shoes", "Casual Loafers", "Trail Runners",
  "Basketball Shoes", "Skate Shoes", "Slip-On Sneakers", "Hiking Boots",
  "Leather Oxfords", "Chunky Dad Sneakers", "Lightweight Trainers",
  "Retro Court Shoes", "Wave Runner Shoes", "Mesh Breathable Shoes",
];
const SHOE_ADJS = [
  "Breathable", "Lightweight", "Waterproof", "Non-Slip", "Shock-Absorbing",
  "Anti-Odor", "Cushioned", "Ergonomic", "Ultralight", "All-Season",
  "Vintage", "Streetwear", "Premium", "Wholesale-Grade", "OEM",
];
const SHOE_MATERIALS = ["Flyknit Mesh", "Genuine Leather", "PU Leather", "Canvas", "Suede", "Rubber Sole", "EVA Foam", "TPU"];
const SHOE_GENDERS = ["Men's", "Women's", "Unisex", "Boys'", "Girls'"];
const SHOE_SIZES = ["35-40", "36-41", "37-44", "38-45", "39-46", "40-46"];
const SHOE_COLORS = ["Black", "White", "Grey", "Navy", "Beige", "Red", "Green", "Blue", "Multi"];

const BAG_BRANDS = [
  "OIWAS", "Kaka", "Bange", "Tigernu", "Bagsmart", "Mark Ryden", "Arctic Hunter",
  "Bopai", "Aoking", "Kingsons", "Herschel-CN", "SEAKR", "Fjallpack",
];
const BAG_TYPES = [
  "Laptop Backpack", "Anti-Theft Backpack", "Travel Backpack", "School Bag",
  "Hiking Daypack", "Business Backpack", "Rolltop Backpack", "USB Charging Backpack",
  "Waterproof Rucksack", "Convertible Backpack", "Tactical Backpack",
  "Casual Daypack", "College Bookbag", "Cycling Backpack", "Camera Backpack",
];
const BAG_ADJS = [
  "Waterproof", "Anti-Theft", "USB Charging", "Expandable", "Ultra-Light",
  "Large Capacity", "Ergonomic", "Slim", "Premium", "Wholesale-Grade",
  "Vintage", "Minimalist", "Multifunctional", "OEM/ODM", "Reinforced",
];
const BAG_MATERIALS = ["600D Oxford", "Nylon Cordura", "Genuine Leather", "PU Leather", "Ripstop Polyester", "Canvas", "TPU-Coated"];
const BAG_CAPACITIES = ["15L", "20L", "25L", "30L", "35L", "40L", "45L"];
const BAG_COLORS = ["Black", "Grey", "Navy", "Army Green", "Khaki", "Blue", "Burgundy"];

const CITIES = ["Guangzhou", "Yiwu", "Shenzhen", "Quanzhou", "Fuzhou", "Wenzhou", "Dongguan", "Shanghai", "Ningbo", "Jinjiang", "Putian", "Hangzhou"];
const SUPPLIER_SUFFIX = ["Trading Co., Ltd.", "Industrial Co., Ltd.", "Import & Export Co., Ltd.", "Manufacturing Co., Ltd.", "Footwear Co., Ltd.", "Bags Factory"];

// -- Generators --------------------------------------------------------------

function makeTitle(rng: () => number, cat: Category): string {
  if (cat === "shoes") {
    const parts = [
      pick(rng, SHOE_ADJS),
      pick(rng, SHOE_GENDERS),
      pick(rng, SHOE_MATERIALS),
      pick(rng, SHOE_TYPES),
    ];
    return parts.join(" ");
  }
  return [
    pick(rng, BAG_ADJS),
    pick(rng, BAG_CAPACITIES),
    pick(rng, BAG_MATERIALS),
    pick(rng, BAG_TYPES),
  ].join(" ");
}

function makeSupplier(rng: () => number, cat: Category): DemoItem["supplier"] {
  const city = pick(rng, CITIES);
  const brand = pick(rng, cat === "shoes" ? SHOE_BRANDS : BAG_BRANDS);
  const name = `${city} ${brand} ${pick(rng, SUPPLIER_SUFFIX)}`;
  const externalId = `sup_${cat}_${Math.floor(rng() * 1e9).toString(36)}`;
  return {
    id: `1688:${externalId}`,
    externalId,
    name,
    country: "CN",
    verified: rng() < 0.7,
  };
}

function makeSpecs(rng: () => number, cat: Category): Record<string, string> {
  if (cat === "shoes") {
    return {
      Brand: pick(rng, SHOE_BRANDS),
      Material: pick(rng, SHOE_MATERIALS),
      "Sole Material": pick(rng, ["Rubber", "EVA", "TPU", "PU"]),
      "Size Range": pick(rng, SHOE_SIZES),
      Color: pick(rng, SHOE_COLORS),
      Gender: pick(rng, SHOE_GENDERS),
      Season: pick(rng, ["Spring/Summer", "Autumn/Winter", "All Season"]),
      "Package Weight": `${(0.6 + rng() * 0.8).toFixed(2)} kg`,
      "Country of Origin": "China",
      Customization: rng() < 0.5 ? "Supported (OEM/ODM)" : "Standard SKU",
    };
  }
  return {
    Brand: pick(rng, BAG_BRANDS),
    Material: pick(rng, BAG_MATERIALS),
    Capacity: pick(rng, BAG_CAPACITIES),
    Color: pick(rng, BAG_COLORS),
    "Laptop Compartment": rng() < 0.75 ? `Fits up to ${pick(rng, ["14", "15.6", "17"])}\" laptop` : "None",
    "Water Resistance": rng() < 0.6 ? "IPX4" : "Splash-proof",
    "Package Weight": `${(0.5 + rng() * 1.1).toFixed(2)} kg`,
    "Country of Origin": "China",
    Customization: rng() < 0.5 ? "Supported (OEM/ODM)" : "Standard SKU",
  };
}

function makeDescription(rng: () => number, cat: Category, title: string): string {
  if (cat === "shoes") {
    return [
      `${title} — designed for wholesale buyers seeking reliable, high-margin footwear.`,
      `Constructed with ${pick(rng, SHOE_MATERIALS).toLowerCase()} upper and a ${pick(rng, ["cushioned EVA", "durable rubber", "shock-absorbing TPU"])} midsole for all-day comfort.`,
      `Available in ${pick(rng, SHOE_COLORS)} and ${pick(rng, SHOE_COLORS)}, sizes ${pick(rng, SHOE_SIZES)}.`,
      `OEM/ODM welcome. Sample orders accepted. Fast dispatch from ${pick(rng, CITIES)}.`,
    ].join(" ");
  }
  return [
    `${title} — engineered for daily commute, travel, and business use.`,
    `Made from ${pick(rng, BAG_MATERIALS).toLowerCase()} with reinforced stitching and YKK-style zippers.`,
    `Features a padded laptop sleeve, hidden anti-theft pocket, and ${pick(rng, ["USB", "TSA-friendly", "expandable side"])} functionality.`,
    `OEM/ODM welcome. Sample orders accepted. Ships worldwide from ${pick(rng, CITIES)}.`,
  ].join(" ");
}

function formatCny(amountMinor: number): string {
  return `¥${(amountMinor / 100).toFixed(2)}`;
}

function generateItem(rng: () => number, cat: Category, index: number): DemoItem {
  const externalId = `demo_${cat}_${String(index + 1).padStart(4, "0")}`;
  const title = makeTitle(rng, cat);
  const priceMajor = cat === "shoes"
    ? 25 + rng() * 375   // ¥25 – ¥400
    : 45 + rng() * 555;  // ¥45 – ¥600
  const amountMinor = Math.round(priceMajor * 100);
  const supplier = makeSupplier(rng, cat);
  const seed = Math.floor(rng() * 1_000_000);
  const imgWidth = 800;
  const imgHeight = 800;
  const specs = makeSpecs(rng, cat);
  return {
    id: `1688:${externalId}`,
    provider: "1688",
    externalId,
    url: `https://detail.1688.com/offer/${externalId}.html`,
    title,
    primaryImage: {
      url: `https://picsum.photos/seed/${externalId}-${seed}/${imgWidth}/${imgHeight}`,
      width: imgWidth,
      height: imgHeight,
    },
    price: { amountMinor, currency: "CNY", display: formatCny(amountMinor) },
    minOrderQty: pick(rng, [1, 2, 5, 10, 20, 50, 100]),
    rating: Math.round((3.6 + rng() * 1.4) * 10) / 10,
    reviewCount: randInt(rng, 3, 2400),
    salesCount: randInt(rng, 12, 18_000),
    supplier,
    shipping: { originCountry: "CN", originCity: pick(rng, CITIES) },
    description: makeDescription(rng, cat, title),
    specifications: specs,
    tags: cat === "shoes"
      ? ["footwear", "wholesale", pick(rng, SHOE_ADJS).toLowerCase()]
      : ["bags", "wholesale", pick(rng, BAG_ADJS).toLowerCase()],
    fetchedAt: new Date().toISOString(),
  };
}

function generateCatalog(cat: Category, count = 500): DemoItem[] {
  const seed = cat === "shoes" ? 0x51_0e_5a : 0xba_c4_9a;
  const rng = mulberry32(seed);
  const items: DemoItem[] = [];
  for (let i = 0; i < count; i++) items.push(generateItem(rng, cat, i));
  return items;
}

// -- Disk persistence --------------------------------------------------------

async function findWritableCacheDir(): Promise<string> {
  for (const dir of CACHE_ROOT_CANDIDATES) {
    try {
      await fs.mkdir(dir, { recursive: true });
      // Probe writability
      const probe = path.join(dir, ".write-test");
      await fs.writeFile(probe, "");
      await fs.unlink(probe).catch(() => {});
      return dir;
    } catch {
      /* try next */
    }
  }
  // Last resort — return the primary path; caller will surface the error.
  return CACHE_ROOT_CANDIDATES[0]!;
}

async function loadOrGenerate(cat: Category): Promise<DemoItem[]> {
  const dir = await findWritableCacheDir();
  const file = path.join(dir, `${cat}.json`);
  try {
    const raw = await fs.readFile(file, "utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length >= 500) return parsed as DemoItem[];
  } catch {
    /* miss */
  }
  const items = generateCatalog(cat, 500);
  await fs.writeFile(file, JSON.stringify(items, null, 2), "utf8").catch(() => {});
  return items;
}

// -- Public API --------------------------------------------------------------

const memory = new Map<Category, DemoItem[]>();

export function detectDemoCategory(keyword: string): Category | null {
  const k = keyword.trim().toLowerCase();
  if (!k) return null;
  if (/\b(shoe|shoes|sneaker|footwear|trainer)\b/.test(k)) return "shoes";
  if (/\b(backpack|backpacks|rucksack|daypack|bookbag)\b/.test(k)) return "backpacks";
  return null;
}

export async function getDemoCatalog(cat: Category): Promise<DemoItem[]> {
  const cached = memory.get(cat);
  if (cached) return cached;
  const items = await loadOrGenerate(cat);
  memory.set(cat, items);
  return items;
}

export interface DemoPage {
  items: DemoItem[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
  nextPage: number | null;
}

export async function paginateDemo(
  cat: Category,
  page: number,
  pageSize: number,
): Promise<DemoPage> {
  const all = await getDemoCatalog(cat);
  const safePage = Math.max(1, page);
  const safeSize = Math.max(1, Math.min(100, pageSize));
  const from = (safePage - 1) * safeSize;
  const items = all.slice(from, from + safeSize);
  const hasMore = from + items.length < all.length;
  return {
    items,
    page: safePage,
    pageSize: safeSize,
    total: all.length,
    hasMore,
    nextPage: hasMore ? safePage + 1 : null,
  };
}
