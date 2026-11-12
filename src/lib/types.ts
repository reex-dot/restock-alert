import type { StockStatus } from "./detect.ts";

export type { StockStatus };

/** stock: 품절 상품의 재입고를 기다림 / price: 가격 변동을 추적 */
export type Mode = "stock" | "price";

export interface PricePoint {
  /** ISO 시각 */
  t: string;
  price: number | null;
  status: StockStatus;
}

export interface Item {
  id: string;
  url: string;
  name: string | null;
  image: string | null;
  /** 이 문구가 보이면 품절로 판단 (선택) */
  outKeyword: string | null;
  /** 이 가격 이하가 되면 알림 (선택) */
  targetPrice: number | null;
  /** 가격이 내려갈 때마다 알림 */
  notifyOnDrop: boolean;
  active: boolean;
  /** 예전에 만든 항목엔 없을 수 있음 → itemMode()로 읽기 */
  mode?: Mode;

  status: StockStatus;
  /** unknown/오류를 제외한 마지막 확정 재고 상태 — 재입고 판단 기준 */
  lastDefiniteStatus: StockStatus | null;
  price: number | null;
  currency: string | null;
  lowestPrice: number | null;
  highestPrice: number | null;
  source: string | null;
  reason: string | null;

  lastCheckedAt: string | null;
  lastError: string | null;
  errorCount: number;
  lastNotifiedAt: string | null;
  createdAt: string;
  history: PricePoint[];
  /** 일반 요청이 막혀 브라우저로 판별해야 하는 사이트 — 한 번 성공하면 다음부터 바로 브라우저 사용 */
  useBrowser?: boolean;
  /** 마지막 확인에 사용한 방식 */
  fetchedWith?: "http" | "browser";
}

/** mode가 없는 예전 항목은 목표가가 있으면 가격 추적, 아니면 재고 알림으로 간주 */
export function itemMode(item: Pick<Item, "mode" | "targetPrice">): Mode {
  return item.mode ?? (item.targetPrice != null ? "price" : "stock");
}
