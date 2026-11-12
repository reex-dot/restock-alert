export const SESSION_COOKIE_NAME = "restock_session";

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** APP_PASSWORD 기반 세션 토큰. 비밀번호가 바뀌면 기존 토큰은 자동 무효화됩니다. */
export function createSessionToken(): Promise<string> {
  return sha256Hex(`restock-session:${process.env.APP_PASSWORD}`);
}

export async function isValidSessionToken(token: string | undefined | null): Promise<boolean> {
  if (!token || !process.env.APP_PASSWORD) return false;
  return token === (await createSessionToken());
}
