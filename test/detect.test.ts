import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeHtml, parsePrice, normalizeAvailability, looksBlocked } from "../src/lib/detect.ts";

const URL_ = "https://shop.example.com/products/widget";

const ld = (obj: unknown) => `<html><head><script type="application/ld+json">${JSON.stringify(obj)}</script></head><body><h1>x</h1></body></html>`;

test("parsePrice handles common formats", () => {
  assert.equal(parsePrice("$1,299.00"), 1299);
  assert.equal(parsePrice("₩12,900"), 12900);
  assert.equal(parsePrice("1.299,50 €"), 1299.5);
  assert.equal(parsePrice("19,99"), 19.99);
  assert.equal(parsePrice("1.234.567"), 1234567);
  assert.equal(parsePrice(42), 42);
  assert.equal(parsePrice("free"), null);
});

test("normalizeAvailability", () => {
  assert.equal(normalizeAvailability("https://schema.org/InStock"), "in_stock");
  assert.equal(normalizeAvailability("http://schema.org/OutOfStock"), "out_of_stock");
  assert.equal(normalizeAvailability("oos"), "out_of_stock");
  assert.equal(normalizeAvailability("in stock"), "in_stock");
  assert.equal(normalizeAvailability("SoldOut"), "out_of_stock");
  assert.equal(normalizeAvailability("whatever"), "unknown");
});

test("JSON-LD single offer out of stock with price", () => {
  const d = analyzeHtml(
    ld({ "@context": "https://schema.org", "@type": "Product", name: "Widget", offers: { "@type": "Offer", price: "49.00", priceCurrency: "USD", availability: "https://schema.org/OutOfStock" } }),
    URL_,
  );
  assert.equal(d.status, "out_of_stock");
  assert.equal(d.price, 49);
  assert.equal(d.currency, "USD");
  assert.equal(d.name, "Widget");
});

test("JSON-LD @graph, multiple offers: any in stock wins, lowest in-stock price", () => {
  const d = analyzeHtml(
    ld({
      "@graph": [
        { "@type": "WebPage" },
        {
          "@type": ["Product"],
          name: "Shoe",
          offers: [
            { "@type": "Offer", price: 80, availability: "OutOfStock", sku: "s1" },
            { "@type": "Offer", price: 100, availability: "InStock", sku: "s2" },
            { "@type": "Offer", price: 90, availability: "InStock", sku: "s3" },
          ],
        },
      ],
    }),
    URL_,
  );
  assert.equal(d.status, "in_stock");
  assert.equal(d.price, 90);
});

test("variant param selects matching offer", () => {
  const html = ld({
    "@type": "Product",
    offers: [
      { "@type": "Offer", price: 10, availability: "InStock", sku: "111" },
      { "@type": "Offer", price: 12, availability: "OutOfStock", sku: "222" },
    ],
  });
  assert.equal(analyzeHtml(html, URL_ + "?variant=222").status, "out_of_stock");
  assert.equal(analyzeHtml(html, URL_ + "?variant=111").status, "in_stock");
});

test("AggregateOffer lowPrice", () => {
  const d = analyzeHtml(ld({ "@type": "Product", offers: { "@type": "AggregateOffer", lowPrice: "15.5", priceCurrency: "EUR", availability: "InStock" } }), URL_);
  assert.equal(d.price, 15.5);
  assert.equal(d.status, "in_stock");
});

test("meta tags", () => {
  const d = analyzeHtml(
    `<html><head><meta property="product:availability" content="oos"><meta property="product:price:amount" content="29.99"><meta property="og:title" content="Bag"></head><body></body></html>`,
    URL_,
  );
  assert.equal(d.status, "out_of_stock");
  assert.equal(d.price, 29.99);
  assert.equal(d.name, "Bag");
});

test("heuristics: disabled buy button / sold out text / enabled button", () => {
  assert.equal(analyzeHtml(`<body><button disabled>Add to cart</button></body>`, URL_).status, "unknown");
  assert.equal(analyzeHtml(`<body><p>Sold out</p><button disabled>Add to cart</button></body>`, URL_).status, "out_of_stock");
  assert.equal(analyzeHtml(`<body><p>This item is Sold Out</p></body>`, URL_).status, "out_of_stock");
  assert.equal(analyzeHtml(`<body><p>Related: sold out</p><button>Add to Cart</button></body>`, URL_).status, "in_stock");
  assert.equal(analyzeHtml(`<body><p>hello</p></body>`, URL_).status, "unknown");
});

test("user keyword overrides structured data", () => {
  const html = `<html><head><script type="application/ld+json">{"@type":"Product","offers":{"availability":"InStock"}}</script></head><body><div>현재 일시품절 상품입니다</div></body></html>`;
  assert.equal(analyzeHtml(html, URL_, { outKeyword: "일시품절" }).status, "out_of_stock");
  assert.equal(analyzeHtml(html, URL_, { outKeyword: "Coming soon" }).status, "in_stock");
});

test("text inside scripts is ignored by heuristics", () => {
  assert.equal(analyzeHtml(`<body><script>var t="sold out";</script><p>ok</p></body>`, URL_).status, "unknown");
});

test("looksBlocked", () => {
  assert.equal(looksBlocked("<html>Robot Check</html>"), true);
  assert.equal(looksBlocked("<html>ok</html>", 403), true);
  assert.equal(looksBlocked("<html>product</html>"), false);
});

test("header cart link is not a buy button", () => {
  assert.equal(analyzeHtml(`<body><header><button>장바구니 담기</button></header><main><p>상품</p></main></body>`, URL_).status, "unknown");
  assert.equal(analyzeHtml(`<body><button>장바구니</button></body>`, URL_).status, "unknown");
  assert.equal(analyzeHtml(`<body><main><button>장바구니 담기</button></main></body>`, URL_).status, "in_stock");
});

test("amazon: buy box, currently unavailable, ship restriction", () => {
  const A = "https://www.amazon.com/dp/B000TEST";
  const inStock = analyzeHtml(
    `<body><span id="productTitle"> Echo Dot </span><div id="corePrice_feature_div"><span class="a-offscreen">$49.99</span></div><input id="add-to-cart-button" type="submit"></body>`,
    A,
  );
  assert.deepEqual([inStock.status, inStock.price, inStock.currency, inStock.name], ["in_stock", 49.99, "USD", "Echo Dot"]);
  assert.equal(analyzeHtml(`<body><div id="availability"><span>Currently unavailable.</span></div></body>`, A).status, "out_of_stock");
  const ship = analyzeHtml(`<body><div id="buybox"><div id="outOfStock">이 품목은 선택하신 배송 위치로 배송할 수 없습니다.</div></div><nav><button>장바구니 담기</button></nav></body>`, A);
  assert.equal(ship.status, "unknown");
  assert.match(ship.reason, /배송/);
});

test("extractSharedUrl picks URL from Android share text", async () => {
  const { extractSharedUrl } = await import("../src/lib/share.ts");
  assert.equal(extractSharedUrl("", "AIRism 티셔츠 https://www.uniqlo.com/us/en/products/E465185-000/00?colorCode=COL09 공유", "제목"), "https://www.uniqlo.com/us/en/products/E465185-000/00?colorCode=COL09");
  assert.equal(extractSharedUrl("https://a.com/p/1", "x"), "https://a.com/p/1");
  assert.equal(extractSharedUrl(null, "링크 https://b.com/x.", null), "https://b.com/x");
  assert.equal(extractSharedUrl(null, "no link", "title"), null);
});
