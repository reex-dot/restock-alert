/**
 * 로컬(맥에서 npm run dev / start) 실행 시 서버 안에서 주기적으로 전체 확인을 돌립니다.
 * Vercel 같은 서버리스에선 동작하지 않으므로 외부 크론이 /api/check 를 호출하게 하세요.
 */
const g = globalThis as typeof globalThis & { __restockTimer?: NodeJS.Timeout; __restockNextAt?: number };

export function intervalMinutes(): number {
  const n = Number(process.env.CHECK_INTERVAL_MINUTES ?? 30);
  return Number.isFinite(n) && n >= 1 ? n : 30;
}

export function schedulerEnabled(): boolean {
  return !process.env.VERCEL && process.env.LOCAL_SCHEDULER !== "off";
}

export function startScheduler() {
  if (!schedulerEnabled() || g.__restockTimer) return;
  const ms = intervalMinutes() * 60_000;
  const tick = async () => {
    g.__restockNextAt = Date.now() + ms;
    try {
      const { checkAll } = await import("./checker.ts");
      const r = await checkAll();
      console.log(`[restock] ${new Date().toLocaleString("ko-KR")} 확인 ${r.checked}건, 오류 ${r.errors}건`);
    } catch (e) {
      console.error("[restock] 확인 실패", e);
    }
  };
  g.__restockNextAt = Date.now() + ms;
  g.__restockTimer = setInterval(tick, ms);
  console.log(`[restock] 로컬 스케줄러 시작: ${intervalMinutes()}분 간격`);
}

export function schedulerInfo() {
  return { enabled: schedulerEnabled(), intervalMinutes: intervalMinutes(), nextAt: g.__restockNextAt ?? null };
}
