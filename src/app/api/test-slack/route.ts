import { NextResponse } from "next/server";
import { isSlackConfigured, sendSlack } from "@/lib/notify.ts";

export async function POST() {
  if (!isSlackConfigured()) return NextResponse.json({ error: "SLACK_WEBHOOK_URL이 설정되지 않았습니다." }, { status: 400 });
  try {
    await sendSlack({ title: "🔔 재고 알리미 테스트", lines: ["슬랙 알림이 정상적으로 연결됐습니다."], url: "https://example.com" });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
