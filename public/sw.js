// 홈 화면 설치용 최소 서비스 워커 — 캐시하지 않고 항상 네트워크에서 최신 데이터를 받음
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});
