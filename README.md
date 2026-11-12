# 재고 알리미 (restock-alert)

> 📱 **안드로이드 폰에서 쓰려면 [DEPLOY.md](DEPLOY.md)** 를 따라 무료로 배포하세요 (Vercel + Neon + cron-job.org + 슬랙 앱). 크롬 판별은 GitHub Actions로 30분마다 무료 실행됩니다.

품절 상품 URL을 등록하면 **재입고**, **목표가 도달**, **가격 하락**을 슬랙으로 알려주는 개인용 웹앱입니다.

## 빠른 시작 (내 맥에서 실행)

```bash
cp .env.example .env.local   # SLACK_WEBHOOK_URL 입력
npm install
npm run dev                  # http://localhost:3300
```

로컬에서 실행하면 서버 안에서 `CHECK_INTERVAL_MINUTES`(기본 30분)마다 자동으로 전체 확인을 돌립니다.
데이터는 `data/items.json`에 저장됩니다.

### 슬랙 Webhook 발급
1. https://api.slack.com/apps → **Create New App** → From scratch
2. **Incoming Webhooks** 켜기 → **Add New Webhook to Workspace** → 알림 받을 채널 선택
3. 발급된 `https://hooks.slack.com/services/...` 주소를 `SLACK_WEBHOOK_URL`에 입력
4. 화면 우측 상단 "슬랙 연결됨 · 테스트"로 확인

## 판별 방식 (신뢰도 높은 순)
1. **품절 판별 문구** (직접 지정 시): 문구가 있으면 품절, 사라지면 재입고
2. **Shopify** 상품 JSON (`/products/{handle}.js`), `?variant=` 옵션 단위 지원
3. **JSON-LD** schema.org `Offer.availability` / 가격
4. 메타태그 `product:availability`, 마이크로데이터
5. **아마존** 전용 요소(구매 버튼, Currently unavailable)
6. 휴리스틱: 본문의 활성 구매 버튼, "sold out/품절" 문구

일반 요청으로 "판별 불가"나 "차단"이 나오면, 로컬 실행일 때는 **맥에 설치된 Google Chrome으로 페이지를 렌더링**해서 같은 순서로 다시 판별합니다(자바스크립트로 그려지는 페이지용). 크롬으로 성공한 상품은 다음부터 바로 크롬으로 확인합니다(카드에 🌐 표시). 매번 새 시크릿 창을 쓰기 때문에 내 크롬 프로필이나 로그인 정보는 쓰지 않으며, `BROWSER_FALLBACK=off`로 끌 수 있습니다.

자동 판별이 "확인 불가"로 나오면 상품 페이지에서 품절일 때만 보이는 문구(예: `Sold out`, `Notify me`)를 설정에 넣으세요.

## 알림 조건
- **재입고**: 마지막 확정 상태가 품절 → 재고 있음
- **목표가**: 목표가보다 비쌌다가 목표가 이하로 내려옴 (구간 진입 시 1회)
- **가격 하락**: "가격이 내려갈 때마다 알림"이 켜져 있고 직전보다 내려감
- 등록 직후 첫 확인에서는 알림을 보내지 않음

## 한계
- 상당수 대형 해외몰(B&H, REI, Newegg 등)은 자동 접근을 **봇으로 차단**(403/429)합니다. 이 앱은 봇 탐지를 우회하지 않으므로, 크롬으로 열어도 차단되면 "자동 접근 차단" 오류로 표시됩니다. 이런 사이트는 공식 재입고 알림(Notify me)을 쓰는 게 확실합니다.
- 아마존은 접속 지역(한국 IP)으로 배송이 안 되는 상품의 가격·재고를 숨깁니다.
- 자바스크립트로만 그려지는 페이지는 판별이 어려울 수 있습니다.

## 배포 (선택)
Vercel 등 서버리스에 올릴 때:
- `DATABASE_URL`: Postgres(Neon 무료 등). 테이블은 처음 접속 시 자동 생성
- `APP_PASSWORD`: 웹 접근 비밀번호
- `CRON_SECRET`: cron-job.org 등 외부 크론이 `https://<앱>/api/check?key=<값>`을 주기적으로 호출

## 개발
```bash
npm test        # 판별·알림 로직 단위 테스트
npm run build
```
