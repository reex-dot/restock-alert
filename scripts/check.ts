/**
 * GitHub Actions에서 30분마다 실행되는 전체 확인 스크립트.
 * 러너에 설치된 Google Chrome으로 자바스크립트 페이지까지 판별하고, 결과를 Neon DB에 저장합니다.
 *
 * 필요한 비밀값(GitHub 저장소 Settings → Secrets → Actions):
 *   DATABASE_URL       Neon 연결 주소 (필수)
 *   SLACK_WEBHOOK_URL  슬랙 알림 주소 (선택)
 */
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL 비밀값이 없습니다. 저장소 Settings → Secrets and variables → Actions 에 추가하세요.");
  process.exit(1);
}

const { checkAll } = await import("../src/lib/checker.ts");
const { browserAvailable } = await import("../src/lib/browser.ts");

console.log(`크롬 판별: ${browserAvailable() ? "사용" : "사용 불가 (CHROME_PATH 확인)"}`);
const started = Date.now();
const r = await checkAll();
console.log(`확인 ${r.checked}건, 오류 ${r.errors}건, 건너뜀 ${r.skipped}건, ${((Date.now() - started) / 1000).toFixed(1)}초`);
// 크롬·DB 연결이 남아 프로세스가 안 끝나는 것을 막음
process.exit(0);

export {};
