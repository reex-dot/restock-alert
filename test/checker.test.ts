import { test } from "node:test";
import assert from "node:assert/strict";
import { applyDetection, newItem } from "../src/lib/checker.ts";
import type { Detection } from "../src/lib/detect.ts";

const det = (over: Partial<Detection>): Detection => ({
  status: "in_stock",
  price: 100,
  currency: "USD",
  name: "Widget",
  image: null,
  source: "test",
  reason: "test",
  ...over,
});

test("first check never alerts", () => {
  const { alerts } = applyDetection(newItem("https://x/p", { mode: "price", targetPrice: 200, notifyOnDrop: true }), det({}));
  assert.equal(alerts.length, 0);
});

test("restock alert fires on out → in, even through unknown", () => {
  let item = newItem("https://x/p", {});
  item = applyDetection(item, det({ status: "out_of_stock" })).item;
  item = applyDetection(item, det({ status: "unknown" })).item;
  const r = applyDetection(item, det({ status: "in_stock" }));
  assert.equal(r.alerts.length, 1);
  assert.match(r.alerts[0].title, /재입고/);
  // 이미 재고 있음 → 다시 알리지 않음
  assert.equal(applyDetection(r.item, det({ status: "in_stock" })).alerts.length, 0);
});

test("target price alerts only when crossing", () => {
  let item = newItem("https://x/p", { mode: "price", targetPrice: 80 });
  item = applyDetection(item, det({ price: 100 })).item;
  const r1 = applyDetection(item, det({ price: 79 }));
  assert.equal(r1.alerts.length, 1);
  assert.match(r1.alerts[0].title, /목표가/);
  assert.equal(applyDetection(r1.item, det({ price: 75 })).alerts.length, 0);
});

test("price drop alert with percentage, tracks low/high", () => {
  let item = newItem("https://x/p", { mode: "price", notifyOnDrop: true });
  item = applyDetection(item, det({ price: 100 })).item;
  item = applyDetection(item, det({ price: 120 })).item;
  const r = applyDetection(item, det({ price: 90 }));
  assert.equal(r.alerts.length, 1);
  assert.match(r.alerts[0].lines[0], /-25\.0%/);
  assert.equal(r.item.lowestPrice, 90);
  assert.equal(r.item.highestPrice, 120);
});

test("history records changes and heartbeat only", () => {
  const t0 = new Date("2026-01-01T00:00:00Z");
  let item = newItem("https://x/p", {});
  item = applyDetection(item, det({ price: 100 }), t0).item;
  item = applyDetection(item, det({ price: 100 }), new Date(t0.getTime() + 60_000)).item;
  assert.equal(item.history.length, 1);
  item = applyDetection(item, det({ price: 95 }), new Date(t0.getTime() + 120_000)).item;
  assert.equal(item.history.length, 2);
  item = applyDetection(item, det({ price: 95 }), new Date(t0.getTime() + 7 * 3600_000)).item;
  assert.equal(item.history.length, 3);
});

test("stock mode sends only restock alerts, price mode only price alerts", () => {
  // 재고 알림 모드: 가격이 내려가도 알림 없음
  let s = newItem("https://x/p", { mode: "stock", notifyOnDrop: true, targetPrice: 50 });
  s = applyDetection(s, det({ status: "out_of_stock", price: 100 })).item;
  assert.equal(applyDetection(s, det({ status: "out_of_stock", price: 40 })).alerts.length, 0);
  const r = applyDetection(s, det({ status: "in_stock", price: 40 }));
  assert.equal(r.alerts.length, 1);
  assert.match(r.alerts[0].title, /재입고/);

  // 가격 추적 모드: 재입고돼도 알림 없음, 가격 하락만
  let p = newItem("https://x/p", { mode: "price", notifyOnDrop: true });
  p = applyDetection(p, det({ status: "out_of_stock", price: 100 })).item;
  const r2 = applyDetection(p, det({ status: "in_stock", price: 90 }));
  assert.equal(r2.alerts.length, 1);
  assert.match(r2.alerts[0].title, /가격 하락/);
});

test("legacy items without mode: targetPrice → price, otherwise stock", async () => {
  const { itemMode } = await import("../src/lib/types.ts");
  assert.equal(itemMode({ mode: undefined, targetPrice: 10 }), "price");
  assert.equal(itemMode({ mode: undefined, targetPrice: null }), "stock");
  assert.equal(itemMode({ mode: "stock", targetPrice: 10 }), "stock");
});
