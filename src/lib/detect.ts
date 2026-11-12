import * as cheerio from "cheerio";

/**
 * 상품 페이지에서 재고 상태와 가격을 판별합니다.
 *
 * 판별 우선순위(신뢰도 높은 순):
 *   1. 사용자가 지정한 "품절 문구" — 페이지에 있으면 품절, 없으면 재고 있음
 *   2. Shopify 상품 JSON(/products/{handle}.js) — 해외 자사몰 상당수가 Shopify
 *   3. JSON-LD(schema.org Product/Offer) — 대부분의 쇼핑몰이 검색엔진용으로 넣어둠
 *   4. 메타태그(product:availability) · 마이크로데이터(itemprop=availability)
 *   5. 휴리스틱 — 활성화된 "장바구니/구매" 버튼, "품절/sold out" 문구
 */

export type StockStatus = "in_stock" | "out_of_stock" | "unknown";

export interface Detection {
  status: StockStatus;
  price: number | null;
  currency: string | null;
  name: string | null;
  image: string | null;
  /** 어떤 근거로 판별했는지 (UI 표시용) */
  source: string;
  reason: string;
}

export interface DetectOptions {
  /** 이 문구가 페이지에 보이면 품절로 간주 */
  outKeyword?: string | null;
}

export class BlockedError extends Error {}

const IN_STOCK_VALUES = ["instock", "in_stock", "in stock", "limitedavailability", "onlineonly", "instoreonly", "preorder", "presale", "available"];
const OUT_STOCK_VALUES = ["outofstock", "out_of_stock", "out of stock", "oos", "soldout", "sold out", "discontinued", "backorder", "unavailable"];

const OUT_PHRASES = [
  "sold out",
  "out of stock",
  "currently unavailable",
  "temporarily unavailable",
  "temporarily out of stock",
  "no longer available",
  "notify me when available",
  "notify when available",
  "email me when available",
  "품절",
  "일시품절",
  "재고 없음",
  "재고없음",
  "재입고 알림",
  "売り切れ",
  "在庫切れ",
  "缺货",
];

// 헤더의 "장바구니(Cart)" 링크와 헷갈리지 않도록 "담기/추가" 동작이 붙은 문구만 사용
const BUY_BUTTON_PHRASES = ["add to cart", "add to bag", "add to basket", "buy now", "buy it now", "장바구니 담기", "장바구니담기", "장바구니에 담기", "장바구니 추가", "바로구매", "바로 구매", "구매하기", "カートに入れる", "加入购物车"];

const BLOCK_PHRASES = ["are you a robot", "robot check", "verify you are human", "enter the characters you see", "access denied", "attention required", "just a moment...", "captcha"];

/* ───────────────────────── 값 파싱 유틸 ───────────────────────── */

export function normalizeAvailability(value: unknown): StockStatus {
  if (typeof value !== "string") return "unknown";
  const v = value.trim().toLowerCase().replace(/^https?:\/\/schema\.org\//, "");
  if (!v) return "unknown";
  if (OUT_STOCK_VALUES.some((o) => v === o || v.replace(/[\s_-]/g, "") === o.replace(/[\s_-]/g, ""))) return "out_of_stock";
  if (IN_STOCK_VALUES.some((o) => v === o || v.replace(/[\s_-]/g, "") === o.replace(/[\s_-]/g, ""))) return "in_stock";
  return "unknown";
}

/** "₩12,900", "$1,299.00", "1.299,00 €", 129900 같은 값을 숫자로 */
export function parsePrice(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) && value > 0 ? value : null;
  if (typeof value !== "string") return null;
  let s = value.replace(/[^\d.,]/g, "");
  if (!s || !/\d/.test(s)) return null;
  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");
  if (lastDot >= 0 && lastComma >= 0) {
    // 둘 다 있으면 뒤에 오는 쪽이 소수점
    const dec = lastDot > lastComma ? "." : ",";
    const thou = dec === "." ? "," : ".";
    s = s.split(thou).join("").replace(dec, ".");
  } else if (lastComma >= 0) {
    const tail = s.length - lastComma - 1;
    s = tail === 3 || s.split(",").length > 2 ? s.replace(/,/g, "") : s.replace(",", ".");
  } else if (lastDot >= 0 && s.split(".").length > 2) {
    s = s.replace(/\./g, "");
  }
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function absUrl(src: string | null | undefined, base: string): string | null {
  if (!src) return null;
  try {
    return new URL(src, base).toString();
  } catch {
    return null;
  }
}

function firstString(v: unknown): string | null {
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return firstString(v[0]);
  if (v && typeof v === "object" && "url" in v) return firstString((v as { url: unknown }).url);
  return null;
}

/* ───────────────────────── JSON-LD ───────────────────────── */

interface OfferInfo {
  status: StockStatus;
  price: number | null;
  currency: string | null;
  url: string | null;
  sku: string | null;
}

interface ProductInfo {
  name: string | null;
  image: string | null;
  offers: OfferInfo[];
}

function asArray<T>(v: T | T[] | undefined | null): T[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

function hasType(node: Record<string, unknown>, type: string): boolean {
  return asArray(node["@type"] as string | string[]).some((t) => typeof t === "string" && t.toLowerCase() === type.toLowerCase());
}

function collectOffers(offers: unknown, sku: string | null, out: OfferInfo[]) {
  for (const o of asArray(offers as Record<string, unknown> | Record<string, unknown>[])) {
    if (!o || typeof o !== "object") continue;
    if (hasType(o, "AggregateOffer")) {
      if (o.offers) collectOffers(o.offers, sku, out);
      else
        out.push({
          status: normalizeAvailability(o.availability),
          price: parsePrice(o.lowPrice ?? o.price),
          currency: (o.priceCurrency as string) ?? null,
          url: null,
          sku,
        });
      continue;
    }
    const spec = asArray(o.priceSpecification as Record<string, unknown>)[0] as Record<string, unknown> | undefined;
    out.push({
      status: normalizeAvailability(o.availability),
      price: parsePrice(o.price ?? o.lowPrice ?? spec?.price),
      currency: ((o.priceCurrency ?? spec?.priceCurrency) as string) ?? null,
      url: firstString(o.url),
      sku: (o.sku as string) ?? sku,
    });
  }
}

export function extractJsonLdProducts($: cheerio.CheerioAPI): ProductInfo[] {
  const products: ProductInfo[] = [];
  const visit = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach(visit);
    const n = node as Record<string, unknown>;
    if (n["@graph"]) visit(n["@graph"]);
    if (hasType(n, "Product") || hasType(n, "ProductGroup")) {
      const offers: OfferInfo[] = [];
      collectOffers(n.offers, (n.sku as string) ?? null, offers);
      for (const v of asArray(n.hasVariant as Record<string, unknown>[])) {
        if (v && typeof v === "object") collectOffers(v.offers, (v.sku as string) ?? null, offers);
      }
      products.push({ name: (n.name as string) ?? null, image: firstString(n.image), offers });
    }
  };
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).contents().text().trim();
    if (!raw) return;
    try {
      visit(JSON.parse(raw));
    } catch {
      // 일부 쇼핑몰은 깨진 JSON(끝 쉼표, 개행)을 넣음 — 제어문자만 지우고 한 번 더 시도
      try {
        visit(JSON.parse(raw.replace(/[\u0000-\u001f]+/g, " ")));
      } catch {
        /* 무시 */
      }
    }
  });
  return products;
}

/** URL에 ?variant=123 같은 옵션 지정이 있으면 해당 옵션의 오퍼를 고릅니다 */
function pickOffer(offers: OfferInfo[], pageUrl: string): OfferInfo | null {
  const known = offers.filter((o) => o.status !== "unknown" || o.price != null);
  if (!known.length) return null;
  let variant: string | null = null;
  try {
    const u = new URL(pageUrl);
    variant = u.searchParams.get("variant") ?? u.searchParams.get("sku");
  } catch {
    /* 무시 */
  }
  if (variant) {
    const hit = known.find((o) => o.sku === variant || (o.url && o.url.includes(variant)));
    if (hit) return hit;
  }
  // 옵션이 여러 개면: 하나라도 재고 있으면 "재고 있음", 가격은 재고 있는 것 중 최저가
  const inStock = known.filter((o) => o.status === "in_stock");
  if (inStock.length) {
    return inStock.reduce((a, b) => ((b.price ?? Infinity) < (a.price ?? Infinity) ? b : a));
  }
  if (known.some((o) => o.status === "out_of_stock")) {
    const out = known.filter((o) => o.status === "out_of_stock");
    return out.reduce((a, b) => ((b.price ?? Infinity) < (a.price ?? Infinity) ? b : a));
  }
  return known[0];
}

/* ───────────────────────── 본 판별 ───────────────────────── */

function meta($: cheerio.CheerioAPI, ...names: string[]): string | null {
  for (const n of names) {
    const v = $(`meta[property="${n}"], meta[name="${n}"], meta[itemprop="${n}"]`).attr("content");
    if (v && v.trim()) return v.trim();
  }
  return null;
}

function visibleText($: cheerio.CheerioAPI): string {
  const $c = cheerio.load($.html());
  $c("script, style, noscript, template, svg").remove();
  return $c("body").text().replace(/\s+/g, " ").toLowerCase();
}

export function looksBlocked(html: string, status = 200): boolean {
  if (status === 403 || status === 429 || status === 503) return true;
  const head = html.slice(0, 20000).toLowerCase();
  // 실제 상품 페이지에도 'captcha' 스크립트가 들어있을 수 있어, 본문이 짧은 경우만 차단으로 판단
  return html.length < 60000 && BLOCK_PHRASES.some((p) => head.includes(p));
}

/** 아마존: 구조화 데이터가 없어 고유 요소 ID로 판별 */
function analyzeAmazon($: cheerio.CheerioAPI, pageUrl: string): Omit<Detection, "status" | "source" | "reason"> & { status: StockStatus | null; reason: string } {
  const txt = (sel: string) => $(sel).first().text().replace(/\s+/g, " ").trim();
  const name = txt("#productTitle") || null;
  const image = absUrl($("#landingImage").attr("data-old-hires") || $("#landingImage").attr("src"), pageUrl);
  let price: number | null = null;
  for (const sel of ["#corePrice_feature_div .a-offscreen", "#corePriceDisplay_desktop_feature_div .a-offscreen", ".priceToPay .a-offscreen", "#apex_desktop .a-offscreen", "#price_inside_buybox", "#priceblock_ourprice"]) {
    price = parsePrice(txt(sel));
    if (price != null) break;
  }
  const priceText = txt("#corePrice_feature_div .a-offscreen") || txt(".priceToPay .a-offscreen");
  const currency = priceText.startsWith("$") ? "USD" : priceText.startsWith("₩") ? "KRW" : priceText.startsWith("€") ? "EUR" : priceText.startsWith("£") ? "GBP" : priceText.startsWith("¥") ? "JPY" : null;
  const base = { name, image, price, currency };

  if ($("#add-to-cart-button, #buy-now-button").length) return { ...base, status: "in_stock", reason: "구매 버튼 있음" };
  const oos = (txt("#outOfStock") + " " + txt("#availability")).toLowerCase();
  if (/currently unavailable|out of stock|일시적으로 품절|현재 구매할 수 없습니다|在庫切れ/.test(oos)) {
    return { ...base, status: "out_of_stock", reason: "Currently unavailable" };
  }
  if (/배송할 수 없습니다|cannot be shipped|can't be shipped|does not ship/.test(oos + " " + txt("#buybox").toLowerCase())) {
    return { ...base, status: "unknown", reason: "서버 위치로 배송이 안 돼 아마존이 재고·가격을 숨김 — 해외 서버에서 실행하거나 품절 문구를 지정하세요" };
  }
  if (/see all buying options|모든 구매 옵션 보기/.test(txt("#buybox").toLowerCase())) {
    return { ...base, status: "unknown", reason: "판매자 선택 페이지 — 기본 구매 버튼 없음" };
  }
  return { ...base, status: null, reason: "" };
}

export function analyzeHtml(html: string, pageUrl: string, opts: DetectOptions = {}): Detection {
  const $ = cheerio.load(html);
  if (/(^|\.)amazon\.[a-z.]+$/.test(new URL(pageUrl).hostname) && !opts.outKeyword?.trim()) {
    const a = analyzeAmazon($, pageUrl);
    if (a.status) return { ...a, status: a.status, source: "아마존", reason: a.reason };
  }
  const products = extractJsonLdProducts($);
  const product = products.find((p) => p.offers.length) ?? products[0] ?? null;
  const offer = product ? pickOffer(product.offers, pageUrl) : null;

  const name =
    product?.name ?? meta($, "og:title", "twitter:title") ?? ($("title").first().text().trim() || null);
  const image = absUrl(meta($, "og:image", "twitter:image") ?? product?.image, pageUrl);

  let price = offer?.price ?? parsePrice(meta($, "product:price:amount", "og:price:amount"));
  let currency = offer?.currency ?? meta($, "product:price:currency", "og:price:currency");
  if (price == null) {
    const el = $('[itemprop="price"]').first();
    price = parsePrice(el.attr("content") ?? el.text());
    currency = currency ?? $('[itemprop="priceCurrency"]').first().attr("content") ?? null;
  }

  const base = { price, currency, name, image };

  // 1. 사용자 지정 문구
  const kw = opts.outKeyword?.trim();
  if (kw) {
    const text = visibleText($);
    const found = text.includes(kw.toLowerCase());
    return {
      ...base,
      status: found ? "out_of_stock" : "in_stock",
      source: "사용자 문구",
      reason: found ? `"${kw}" 문구가 페이지에 있음` : `"${kw}" 문구가 사라짐`,
    };
  }

  // 3. JSON-LD
  if (offer && offer.status !== "unknown") {
    return { ...base, status: offer.status, source: "구조화 데이터", reason: "schema.org Offer availability" };
  }

  // 4. 메타태그 / 마이크로데이터
  const metaAvail = normalizeAvailability(meta($, "product:availability", "og:availability", "availability"));
  if (metaAvail !== "unknown") return { ...base, status: metaAvail, source: "메타태그", reason: "product:availability" };
  const micro = $('[itemprop="availability"]').first();
  const microAvail = normalizeAvailability(micro.attr("href") ?? micro.attr("content") ?? micro.text());
  if (microAvail !== "unknown") return { ...base, status: microAvail, source: "마이크로데이터", reason: "itemprop=availability" };

  // 5. 휴리스틱
  let enabledBuy = false;
  let disabledBuy = false;
  $('button, input[type="submit"], a[role="button"]').each((_, el) => {
    const $el = $(el);
    if ($el.closest("header, nav, footer, [role=navigation], [role=banner]").length) return;
    const label = ($el.text() || $el.attr("value") || $el.attr("aria-label") || "").replace(/\s+/g, " ").trim().toLowerCase();
    if (!label || label.length > 40 || !BUY_BUTTON_PHRASES.some((p) => label.includes(p))) return;
    const disabled =
      $el.is("[disabled]") || $el.attr("aria-disabled") === "true" || /\b(disabled|sold-?out|soldout)\b/i.test($el.attr("class") ?? "");
    if (disabled) disabledBuy = true;
    else enabledBuy = true;
  });
  const text = visibleText($);
  const outPhrase = OUT_PHRASES.find((p) => text.includes(p));

  if (enabledBuy) return { ...base, status: "in_stock", source: "페이지 분석", reason: "구매 버튼이 활성화됨" };
  // 버튼 비활성만으로는 품절로 보지 않음 — 옵션(사이즈) 선택 전 비활성인 쇼핑몰이 많아 가짜 재입고 알림의 원인이 됨
  if (outPhrase) return { ...base, status: "out_of_stock", source: "페이지 분석", reason: `"${outPhrase}" 문구 발견${disabledBuy ? " + 구매 버튼 비활성" : ""}` };
  if (disabledBuy) return { ...base, status: "unknown", source: "페이지 분석", reason: "구매 버튼이 비활성(옵션 선택 전일 수 있음) — 품절 문구를 지정해 보세요" };
  return { ...base, status: "unknown", source: "페이지 분석", reason: "재고 정보를 찾지 못함 — 품절 문구를 직접 지정해 보세요" };
}

/* ───────────────────────── 네트워크 ───────────────────────── */

const HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
};

async function fetchText(url: string, accept?: string): Promise<{ status: number; text: string; finalUrl: string }> {
  const res = await fetch(url, {
    headers: accept ? { ...HEADERS, Accept: accept } : HEADERS,
    redirect: "follow",
    signal: AbortSignal.timeout(20000),
    cache: "no-store",
  });
  return { status: res.status, text: await res.text(), finalUrl: res.url || url };
}

interface ShopifyProduct {
  title: string;
  available: boolean;
  featured_image?: string;
  variants: { id: number; available: boolean; price: number }[];
}

/** 같은 사이트의 다른 주소(Shopify 상품 JSON 등)를 가져오는 방법 — 일반 요청 또는 브라우저 */
export type SubFetch = (url: string) => Promise<{ status: number; text: string } | null>;

/** Shopify 몰이면 상품 JSON으로 정확히 판별 (HTML보다 훨씬 신뢰도 높음) */
async function tryShopify(pageUrl: string, html: string, getText: SubFetch, outKeyword?: string | null): Promise<Detection | null> {
  if (outKeyword?.trim()) return null;
  if (!/cdn\.shopify\.com|Shopify\.shop|shopify-section/i.test(html)) return null;
  const u = new URL(pageUrl);
  const m = u.pathname.match(/\/products\/([^/?#]+)/);
  if (!m) return null;
  try {
    const res = await getText(`${u.origin}/products/${m[1]}.js`);
    if (!res || res.status !== 200) return null;
    const p = JSON.parse(res.text) as ShopifyProduct;
    if (!p || !Array.isArray(p.variants)) return null;
    const variantId = u.searchParams.get("variant");
    const v = variantId ? p.variants.find((x) => String(x.id) === variantId) : null;
    const targets = v ? [v] : p.variants;
    const avail = targets.filter((x) => x.available);
    const priced = (avail.length ? avail : targets).map((x) => x.price).filter((x) => typeof x === "number");
    const currency =
      html.match(/Shopify\.currency\s*=\s*\{[^}]*"active"\s*:\s*"([A-Z]{3})"/)?.[1] ??
      cheerio.load(html)('meta[property="og:price:currency"]').attr("content") ??
      null;
    return {
      status: avail.length ? "in_stock" : "out_of_stock",
      price: priced.length ? Math.min(...priced) / 100 : null,
      currency,
      name: p.title ?? null,
      image: absUrl(p.featured_image, pageUrl),
      source: "Shopify",
      reason: v ? "선택한 옵션의 재고 기준" : avail.length ? `${avail.length}/${p.variants.length}개 옵션 구매 가능` : "모든 옵션 품절",
    };
  } catch {
    return null;
  }
}

/** 받아온 페이지(일반 요청이든 브라우저 렌더링이든)를 판별 */
export async function analyzePage(html: string, finalUrl: string, opts: DetectOptions, getText: SubFetch): Promise<Detection> {
  const shopify = await tryShopify(finalUrl, html, getText, opts.outKeyword);
  if (shopify) {
    const fromHtml = analyzeHtml(html, finalUrl, opts);
    return { ...shopify, name: shopify.name ?? fromHtml.name, image: fromHtml.image ?? shopify.image };
  }
  return analyzeHtml(html, finalUrl, opts);
}

/** 일반 HTTP 요청으로 확인 (빠름, 서버리스에서도 동작) */
export async function checkUrl(url: string, opts: DetectOptions = {}): Promise<Detection> {
  const res = await fetchText(url);
  if (looksBlocked(res.text, res.status)) {
    throw new BlockedError(`사이트가 자동 접근을 차단했습니다 (HTTP ${res.status})`);
  }
  if (res.status >= 400) throw new Error(`페이지를 불러오지 못했습니다 (HTTP ${res.status})`);
  return analyzePage(res.text, res.finalUrl, opts, (u) => fetchText(u, "application/json"));
}
