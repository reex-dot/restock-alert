import { NextResponse } from "next/server";
import { checkAll } from "@/lib/checker.ts";

// Vercel 무료(Hobby) 플랜 한도 안쪽으로
export const maxDuration = 60;

/**
 * 외부 크론(cron-job.org, GitHub Actions 등)이 주기적으로 호출하는 엔드포인트.
 * CRON_SECRET이 설정돼 있으면 `Authorization: Bearer {값}` 또는 `?key={값}` 필요.
 */
async function handle(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    const key = new URL(req.url).searchParams.get("key");
    if (auth !== `Bearer ${secret}` && key !== secret) {
      console.warn("[check] 키가 맞지 않는 호출 거부");
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  } else if (process.env.VERCEL) {
    return NextResponse.json({ error: "배포 환경에서는 CRON_SECRET을 설정해야 합니다." }, { status: 500 });
  }
  const started = Date.now();
  const result = await checkAll();
  // 크론이 실제로 돌고 있는지 Vercel 로그에서 확인할 수 있게 매 실행 한 줄 기록
  console.log(`[check] 확인 ${result.checked}건, 오류 ${result.errors}건, 크롬 전용 건너뜀 ${result.skipped}건, ${((Date.now() - started) / 1000).toFixed(1)}초`);
  return NextResponse.json(result);
}

export const GET = handle;
export const POST = handle;
