/**
 * 슬랙 Incoming Webhook으로 알림을 보냅니다.
 * 설정: https://api.slack.com/apps → Create App → Incoming Webhooks → Add New Webhook
 * 발급받은 URL을 SLACK_WEBHOOK_URL 환경변수에 넣으면 끝.
 */

export interface Alert {
  title: string;
  lines: string[];
  url: string;
  image?: string | null;
}

export function isSlackConfigured() {
  return Boolean(process.env.SLACK_WEBHOOK_URL);
}

export async function sendSlack(alert: Alert): Promise<void> {
  const hook = process.env.SLACK_WEBHOOK_URL;
  if (!hook) {
    console.log(`[알림 미설정] ${alert.title} — ${alert.lines.join(" / ")}`);
    return;
  }
  const body = {
    text: `${alert.title} ${alert.url}`,
    blocks: [
      {
        type: "section",
        text: { type: "mrkdwn", text: `*${alert.title}*\n${alert.lines.join("\n")}\n<${alert.url}|상품 페이지 열기>` },
        ...(alert.image ? { accessory: { type: "image", image_url: alert.image, alt_text: "상품 이미지" } } : {}),
      },
    ],
  };
  let res = await fetch(hook, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok && alert.image) {
    // 이미지 URL을 슬랙이 못 가져오면 블록 전체가 거부되므로 이미지 없이 재시도
    const { accessory: _omit, ...section } = body.blocks[0] as Record<string, unknown>;
    res = await fetch(hook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, blocks: [section] }),
    });
  }
  if (!res.ok) throw new Error(`슬랙 전송 실패: HTTP ${res.status} ${await res.text()}`);
}
