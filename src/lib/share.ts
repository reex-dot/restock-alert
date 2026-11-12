/** 안드로이드 공유로 넘어온 title/text/url 중에서 상품 URL 하나를 골라냄.
 *  쇼핑몰 앱은 보통 url이 비어 있고 text에 "상품명 https://..." 형태로 넣어 보냄 */
export function extractSharedUrl(...parts: (string | null | undefined)[]): string | null {
  for (const p of parts) {
    if (!p) continue;
    const m = p.match(/https?:\/\/[^\s<>"'）)]+/i);
    if (m) return m[0].replace(/[.,!?;:]+$/, "");
  }
  return null;
}
