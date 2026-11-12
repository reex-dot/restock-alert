import { BlockedError, checkUrl, type Detection } from "./detect.ts";
import { browserAvailable } from "./browser.ts";
import { store } from "./store.ts";
import { sendSlack, type Alert } from "./notify.ts";
import { itemMode, type Item, type Mode } from "./types.ts";

const HISTORY_MAX = 1000;
/** 가격·재고 변화가 없어도 이 간격마다 한 점씩 기록 (그래프가 끊기지 않게) */
const HISTORY_HEARTBEAT_MS = 6 * 60 * 60 * 1000;

import { formatPrice } from "./format.ts";

export function newItem(
  url: string,
  opts: { mode?: Mode; outKeyword?: string | null; targetPrice?: number | null; notifyOnDrop?: boolean },
): Item {
  return {
    id: crypto.randomUUID(),
    url,
    mode: opts.mode ?? "stock",
    name: null,
    image: null,
    outKeyword: opts.outKeyword?.trim() || null,
    targetPrice: opts.targetPrice ?? null,
    notifyOnDrop: opts.notifyOnDrop ?? false,
    active: true,
    status: "unknown",
    lastDefiniteStatus: null,
    price: null,
    currency: null,
    lowestPrice: null,
    highestPrice: null,
    source: null,
    reason: null,
    lastCheckedAt: null,
    lastError: null,
    errorCount: 0,
    lastNotifiedAt: null,
    createdAt: new Date().toISOString(),
    history: [],
  };
}

/**
 * 판별 결과를 항목에 반영하고, 보내야 할 알림 목록을 돌려줍니다 (순수 함수 — 테스트 용이).
 *
 * 알림 조건 (항목의 모드에 따라 한쪽만 보냄)
 *  - [재고 알림] 재입고: 마지막 확정 상태가 품절이었다가 재고 있음으로 바뀜
 *  - [가격 추적] 목표가: 목표가 초과 → 이하로 내려옴 (같은 구간에선 한 번만)
 *  - [가격 추적] 가격 하락: notifyOnDrop이 켜져 있고 직전 가격보다 내려감
 * 가격·재고 이력은 모드와 상관없이 항상 기록합니다.
 */
export function applyDetection(prev: Item, d: Detection, now = new Date()): { item: Item; alerts: Alert[] } {
  const item: Item = { ...prev, history: [...prev.history] };
  const alerts: Alert[] = [];
  const nowIso = now.toISOString();

  item.name = d.name ?? item.name;
  item.image = d.image ?? item.image;
  item.status = d.status;
  item.source = d.source;
  item.reason = d.reason;
  item.lastCheckedAt = nowIso;
  item.lastError = null;
  item.errorCount = 0;
  if (d.currency) item.currency = d.currency;

  const label = item.name ?? item.url;
  const mode = itemMode(item);
  const isFirstCheck = prev.lastCheckedAt == null;

  // 재입고
  if (d.status !== "unknown") {
    if (mode === "stock" && prev.lastDefiniteStatus === "out_of_stock" && d.status === "in_stock") {
      alerts.push({
        title: `🎉 재입고: ${label}`,
        lines: [`지금 구매 가능합니다. 현재가 ${formatPrice(d.price, item.currency)}`],
        url: item.url,
        image: item.image,
      });
    }
    item.lastDefiniteStatus = d.status;
  }

  // 가격
  const prevPrice = prev.price;
  if (d.price != null) {
    item.price = d.price;
    item.lowestPrice = item.lowestPrice == null ? d.price : Math.min(item.lowestPrice, d.price);
    item.highestPrice = item.highestPrice == null ? d.price : Math.max(item.highestPrice, d.price);

    const stockNote = d.status === "out_of_stock" ? " (현재 품절)" : "";
    const priceAlerts = mode === "price";
    if (priceAlerts && item.targetPrice != null && d.price <= item.targetPrice && (prevPrice == null ? !isFirstCheck : prevPrice > item.targetPrice)) {
      alerts.push({
        title: `🎯 목표가 도달: ${label}`,
        lines: [`${formatPrice(d.price, item.currency)} ≤ 목표가 ${formatPrice(item.targetPrice, item.currency)}${stockNote}`],
        url: item.url,
        image: item.image,
      });
    } else if (priceAlerts && item.notifyOnDrop && prevPrice != null && d.price < prevPrice) {
      const pct = ((prevPrice - d.price) / prevPrice) * 100;
      alerts.push({
        title: `📉 가격 하락: ${label}`,
        lines: [`${formatPrice(prevPrice, item.currency)} → ${formatPrice(d.price, item.currency)} (-${pct.toFixed(1)}%)${stockNote}`],
        url: item.url,
        image: item.image,
      });
    }
  }

  // 이력
  const last = item.history[item.history.length - 1];
  const changed = !last || last.price !== (d.price ?? last.price) || last.status !== d.status;
  const stale = !last || now.getTime() - new Date(last.t).getTime() >= HISTORY_HEARTBEAT_MS;
  if (changed || stale) {
    item.history.push({ t: nowIso, price: d.price, status: d.status });
    if (item.history.length > HISTORY_MAX) item.history.splice(0, item.history.length - HISTORY_MAX);
  }

  if (alerts.length) item.lastNotifiedAt = nowIso;
  return { item, alerts };
}

/**
 * 확인 방식 선택
 *  1. 이 항목이 브라우저 전용으로 기억돼 있으면 바로 브라우저
 *  2. 아니면 일반 요청 → 차단됐거나 판별 불가면 브라우저로 재시도
 *  3. 브라우저로 성공하면 다음부터 브라우저를 바로 쓰도록 기억
 */
async function detect(item: Item): Promise<{ d: Detection; via: "http" | "browser"; useBrowser: boolean }> {
  const opts = { outKeyword: item.outKeyword };
  const canBrowse = browserAvailable();
  const viaBrowser = async () => (await import("./browser.ts")).checkWithBrowser(item.url, opts);

  if (item.useBrowser && canBrowse) {
    return { d: await viaBrowser(), via: "browser", useBrowser: true };
  }
  let httpResult: Detection | null = null;
  let httpError: unknown = null;
  try {
    httpResult = await checkUrl(item.url, opts);
  } catch (e) {
    httpError = e;
  }
  const blocked = httpError instanceof BlockedError;
  if (httpResult && httpResult.status !== "unknown") return { d: httpResult, via: "http", useBrowser: false };
  if (!canBrowse || (httpError && !blocked)) {
    if (httpResult) return { d: httpResult, via: "http", useBrowser: false };
    throw httpError;
  }
  try {
    const d = await viaBrowser();
    // 일반 요청이 막혔거나, 브라우저가 더 확실한 결과를 냈을 때만 기억
    return { d, via: "browser", useBrowser: blocked || d.status !== "unknown" };
  } catch (e) {
    if (httpResult) return { d: httpResult, via: "http", useBrowser: false };
    throw e;
  }
}

/**
 * 크롬으로만 판별되는 상품인데 지금 환경(Vercel 등)엔 크롬이 없으면 건너뜀.
 * 일반 요청으로 덮어쓰면 "재고 있음"이 "확인 불가"로 바뀌기를 반복하므로,
 * 이런 상품은 크롬이 있는 곳(GitHub Actions의 30분 확인)에서만 갱신합니다.
 */
export function needsBrowserElsewhere(item: Item): boolean {
  return Boolean(item.useBrowser) && !browserAvailable();
}

export async function checkItem(item: Item): Promise<Item> {
  if (needsBrowserElsewhere(item)) return item;
  let updated: Item;
  let alerts: Alert[] = [];
  try {
    const { d, via, useBrowser } = await detect(item);
    ({ item: updated, alerts } = applyDetection(item, d));
    updated.fetchedWith = via;
    updated.useBrowser = useBrowser;
  } catch (e) {
    updated = {
      ...item,
      lastCheckedAt: new Date().toISOString(),
      lastError: e instanceof Error ? e.message : String(e),
      errorCount: item.errorCount + 1,
    };
  }
  // 체크 도중 사용자가 설정을 바꿨거나 삭제했을 수 있으니 최신 설정 위에 결과만 덮어씀
  const latest = await store.get(item.id);
  if (!latest) return updated;
  const merged: Item = {
    ...updated,
    outKeyword: latest.outKeyword,
    targetPrice: latest.targetPrice,
    notifyOnDrop: latest.notifyOnDrop,
    active: latest.active,
    mode: latest.mode,
  };
  await store.save(merged);
  // 상품별 결과를 한 줄씩 남김 (주소는 도메인만 — "확인 불가" 원인을 로그로 추적하기 위함)
  let host = "?";
  try {
    host = new URL(merged.url).hostname.replace(/^www\./, "");
  } catch {
    /* 무시 */
  }
  if (!process.env.QUIET_ITEM_LOG) console.log(
    `[item] ${host} ${itemMode(merged)} → ${merged.lastError ? "오류: " + merged.lastError : `${merged.status} 가격=${merged.price ?? "-"} (${merged.source}: ${merged.reason})`}`,
  );
  for (const a of alerts) {
    try {
      await sendSlack(a);
    } catch (e) {
      console.error(e);
    }
  }
  return merged;
}

type CheckAllResult = { checked: number; errors: number; skipped: number };
let running: Promise<CheckAllResult> | null = null;

/** 활성 항목 전체를 동시 3개씩 확인. 이미 돌고 있으면 그 실행을 공유합니다. */
export function checkAll(): Promise<CheckAllResult> {
  running ??= (async () => {
    try {
      const active = (await store.list()).filter((i) => i.active);
      const items = active.filter((i) => !needsBrowserElsewhere(i));
      const skipped = active.length - items.length;
      let idx = 0;
      let errors = 0;
      const worker = async () => {
        while (idx < items.length) {
          const it = items[idx++];
          const r = await checkItem(it);
          if (r.lastError) errors++;
        }
      };
      await Promise.all(Array.from({ length: Math.min(3, items.length) }, worker));
      return { checked: items.length, errors, skipped };
    } finally {
      running = null;
    }
  })();
  return running;
}
