/** 등록 가능한 URL인지 확인 (http/https만, 내부망 주소 차단) */
export function validateProductUrl(raw: unknown): string {
  if (typeof raw !== "string" || !raw.trim()) throw new Error("URL을 입력해 주세요.");
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw new Error("올바른 URL 형식이 아닙니다.");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("http/https 주소만 등록할 수 있습니다.");
  const h = u.hostname.toLowerCase();
  if (
    h === "localhost" ||
    h.endsWith(".local") ||
    h.endsWith(".internal") ||
    /^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h) ||
    h.startsWith("[")
  ) {
    throw new Error("내부망 주소는 등록할 수 없습니다.");
  }
  u.hash = "";
  return u.toString();
}

export function parseOptionalPrice(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[^\d.]/g, ""));
  if (!Number.isFinite(n) || n <= 0) throw new Error("목표가는 0보다 큰 숫자여야 합니다.");
  return n;
}
