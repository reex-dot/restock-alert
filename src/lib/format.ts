export function formatPrice(price: number | null, currency: string | null): string {
  if (price == null) return "가격 정보 없음";
  try {
    if (currency) return new Intl.NumberFormat("ko-KR", { style: "currency", currency }).format(price);
  } catch {
    /* 잘못된 통화 코드 */
  }
  return price.toLocaleString("ko-KR");
}

export function timeAgo(iso: string | null, now = Date.now()): string {
  if (!iso) return "확인 전";
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return "방금 전";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}분 전`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}시간 전`;
  return `${Math.round(h / 24)}일 전`;
}
