# 배포 가이드 — 안드로이드 폰에서 쓰기 (무료 구성)

구성: **Vercel**(앱) + **Neon**(DB) + **cron-job.org**(30분마다 확인 실행) + **슬랙 앱**(푸시 알림)
비용: 전부 무료 플랜으로 충분합니다.

> 클라우드에서는 크롬 렌더링 판별이 동작하지 않습니다. 일반 요청으로 판별되는 쇼핑몰만 지원되며,
> 판별이 안 되는 상품은 "확인 불가/차단"으로 표시됩니다(설정에서 품절 판별 문구를 넣으면 개선될 수 있음).

---

## 1. 슬랙 Webhook 만들기 (5분)
1. https://api.slack.com/apps → **Create New App** → **From scratch** → 이름·워크스페이스 선택
2. 왼쪽 **Incoming Webhooks** → 스위치 **On**
3. **Add New Webhook to Workspace** → 알림 받을 채널(또는 내 DM) 선택 → 허용
4. `https://hooks.slack.com/services/...` 주소 복사 → 아래 `SLACK_WEBHOOK_URL`
5. 안드로이드 폰에 **슬랙 앱** 설치·로그인 (알림 허용)

## 2. Neon 데이터베이스 연결 (2분, 4단계 배포 후)
1. Vercel 프로젝트 → **Storage** 탭 → **Create Database → Neon (Serverless Postgres)**
2. 지역 **US East (N. Virginia)** — 앱 함수 지역(`vercel.json`의 `iad1`)과 맞춤
3. Free 플랜, Production·Preview에 연결 → `DATABASE_URL`이 자동으로 들어감
4. 테이블은 앱이 처음 실행될 때 자동으로 만들어집니다.

## 3. 비밀값 2개 만들기
맥 터미널에서 아래를 두 번 실행해 나온 값을 각각 사용하세요.
```bash
openssl rand -hex 24
```
- `APP_PASSWORD`: 폰에서 로그인할 때 쓰는 비밀번호 (직접 기억하기 쉬운 값으로 정해도 됨)
- `CRON_SECRET`: 크론이 확인을 실행할 때 쓰는 비밀 키

## 4. Vercel에 배포
```bash
cd restock-alert
npx vercel
```
- 처음이면 브라우저로 로그인 → 질문은 기본값(Enter)으로 진행 → 프로젝트 이름 `restock-alert`
- 배포가 끝나면 https://vercel.com → 프로젝트 → **Settings → Environment Variables** 에 4개 추가

  | 이름 | 값 |
  |---|---|
  | `DATABASE_URL` | 2단계 Neon 주소 |
  | `SLACK_WEBHOOK_URL` | 1단계 슬랙 주소 |
  | `APP_PASSWORD` | 3단계 비밀번호 |
  | `CRON_SECRET` | 3단계 비밀 키 |

- 환경변수를 넣은 뒤 운영 배포:
```bash
npx vercel --prod
```
- 나온 주소(예: `https://restock-alert-xxxx.vercel.app`)를 기억하세요.

## 5. 30분마다 확인하도록 크론 등록
Vercel 무료 플랜의 크론은 하루 1번만 돼서 외부 크론을 씁니다.
1. https://cron-job.org 가입 → **Create cronjob**
2. URL: `https://<내 앱 주소>/api/check?key=<CRON_SECRET>`
3. 실행 주기: **Every 30 minutes** (원하면 15분)
4. 저장 → **Test run** 으로 `{"checked":…}` 응답이 오는지 확인

## 6. 안드로이드 폰에 설치
1. 폰 **크롬**에서 앱 주소 열기 → `APP_PASSWORD`로 로그인
2. 오른쪽 위 **⋮ → 홈 화면에 추가**(또는 **앱 설치**)
3. 이제 홈 화면 아이콘으로 앱처럼 열립니다.

### 상품 등록 — 공유하기로 한 번에
쇼핑몰 앱이나 크롬에서 상품 페이지 → **공유** → **재고 알리미** 선택
→ 주소가 자동으로 채워지면 옵션 확인 후 **모니터링 시작**
(공유 목록에 안 보이면 6-2 홈 화면 설치를 먼저 하세요.)

---

## 동작 확인 체크리스트
- [ ] 앱 오른쪽 위 "슬랙 연결됨" → **테스트** 눌러 폰에 슬랙 알림 도착
- [ ] 상품 하나 등록 → 상품명·가격이 채워짐
- [ ] cron-job.org 실행 기록이 30분마다 성공(200)

---

## (선택) 크롬 판별 — GitHub Actions로 무료 실행

Vercel에는 크롬이 없어서 유니클로처럼 자바스크립트로 그려지는 쇼핑몰은 "확인 불가"가 됩니다.
GitHub Actions가 30분마다 크롬을 띄워 이런 상품까지 확인하고 결과를 같은 DB에 저장하게 할 수 있습니다.
(`.github/workflows/check.yml`, 공개 저장소는 Actions 실행이 무료)

1. 이 코드를 GitHub 저장소로 올림
2. 저장소 **Settings → Secrets and variables → Actions → New repository secret**
   - `DATABASE_URL`: Neon 연결 주소 (Vercel Storage → Neon → **Open in Neon** → Connect → 연결 문자열)
   - `SLACK_WEBHOOK_URL`: (선택) 슬랙 주소
3. **Actions** 탭 → "재고·가격 확인" → **Run workflow** 로 첫 실행 확인

동작 방식
- 일반 요청으로 판별되는 상품: Vercel(cron-job.org)과 GitHub 둘 다 확인
- 크롬이 필요한 상품(카드에 🌐): GitHub에서만 갱신 — Vercel은 덮어쓰지 않고 건너뜀
- GitHub 예약 실행은 몇 분~수십 분 늦어질 수 있습니다.
- 공개 저장소라 실행 로그가 공개되므로, 로그에는 상품별 결과를 남기지 않고 건수만 남깁니다.
