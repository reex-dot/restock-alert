import { NextRequest, NextResponse } from "next/server";
import { isValidSessionToken, SESSION_COOKIE_NAME } from "./lib/auth.ts";

// APP_PASSWORD가 없으면 로그인 없이 사용 (로컬 전용일 때). 배포할 땐 꼭 설정하세요.
// /api/check 는 외부 크론이 호출하므로 핸들러가 CRON_SECRET으로 직접 인증합니다.
// 홈 화면 설치(PWA)에 필요한 매니페스트·아이콘·서비스워커도 로그인 없이 받아갈 수 있어야 함
const PUBLIC_PATHS = ["/login", "/api/auth/login", "/api/check", "/manifest.webmanifest", "/icons", "/sw.js"];

export async function proxy(req: NextRequest) {
  if (!process.env.APP_PASSWORD) return NextResponse.next();
  const { pathname } = req.nextUrl;
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"))) return NextResponse.next();
  if (await isValidSessionToken(req.cookies.get(SESSION_COOKIE_NAME)?.value)) return NextResponse.next();
  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  // 로그인 후 원래 가려던 곳(예: 공유로 들어온 /share?text=...)으로 돌아가도록 next 전달
  const login = new URL("/login", req.url);
  if (pathname !== "/") login.searchParams.set("next", pathname + req.nextUrl.search);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
