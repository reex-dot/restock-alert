import { existsSync } from "node:fs";
import type { Browser, BrowserContext } from "playwright-core";
import { analyzePage, BlockedError, looksBlocked, type Detection, type DetectOptions } from "./detect.ts";

/**
 * 자바스크립트로만 내용이 그려지는 상품 페이지를 맥에 설치된 Google Chrome으로 렌더링해서 판별합니다.
 *
 * - 브라우저를 따로 내려받지 않고 설치된 크롬을 사용 (CHROME_PATH로 경로 변경 가능)
 * - 매번 새 시크릿 컨텍스트 사용 — 내 크롬 프로필·로그인 정보는 쓰지 않음
 * - 봇 탐지를 숨기거나 우회하지 않습니다. 사이트가 봇 확인 화면을 띄우면 "차단됨"으로 처리합니다.
 * - 서버리스(Vercel)에선 동작하지 않음
 */

const DEFAULT_CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const MAX_PAGES = 2;
const IDLE_CLOSE_MS = 3 * 60_000;

type G = typeof globalThis & {
  __rbBrowser?: Promise<Browser> | null;
  __rbIdle?: NodeJS.Timeout;
  __rbActive?: number;
  __rbWaiters?: (() => void)[];
};
const g = globalThis as G;

function chromePath(): string {
  return process.env.CHROME_PATH || DEFAULT_CHROME;
}

export function browserAvailable(): boolean {
  if (process.env.VERCEL || process.env.BROWSER_FALLBACK === "off") return false;
  return existsSync(chromePath());
}

function getBrowser(): Promise<Browser> {
  g.__rbBrowser ??= (async () => {
    const { chromium } = await import("playwright-core");
    const browser = await chromium.launch({ executablePath: chromePath(), headless: true });
    browser.on("disconnected", () => {
      g.__rbBrowser = null;
    });
    return browser;
  })().catch((e) => {
    g.__rbBrowser = null;
    throw e;
  });
  return g.__rbBrowser;
}

async function acquire() {
  g.__rbActive ??= 0;
  g.__rbWaiters ??= [];
  if (g.__rbIdle) clearTimeout(g.__rbIdle);
  if (g.__rbActive >= MAX_PAGES) await new Promise<void>((r) => g.__rbWaiters!.push(r));
  g.__rbActive++;
}

function release() {
  g.__rbActive = Math.max(0, (g.__rbActive ?? 1) - 1);
  const next = g.__rbWaiters?.shift();
  if (next) return next();
  if (g.__rbActive === 0) {
    // 한동안 안 쓰면 크롬을 닫아 메모리 반환
    g.__rbIdle = setTimeout(async () => {
      const browser = await g.__rbBrowser?.catch(() => null);
      g.__rbBrowser = null;
      await browser?.close().catch(() => {});
    }, IDLE_CLOSE_MS);
  }
}

export async function checkWithBrowser(url: string, opts: DetectOptions = {}): Promise<Detection> {
  await acquire();
  let ctx: BrowserContext | null = null;
  try {
    ctx = await (await getBrowser()).newContext({ locale: "ko-KR", viewport: { width: 1366, height: 900 } });
    const page = await ctx.newPage();
    // 이미지·영상·폰트는 판별에 필요 없으니 받지 않음 (속도·데이터 절약)
    await page.route("**/*", (route) => {
      const t = route.request().resourceType();
      return t === "image" || t === "media" || t === "font" ? route.abort() : route.continue();
    });
    const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 }).catch((e: Error) => {
      // Playwright 오류는 "Call log"까지 붙어 길고 영어라 사람이 읽을 수 있게 바꿈
      const code = e.message.match(/net::(ERR_[A-Z0-9_]+)/)?.[1];
      if (code && /HTTP2_PROTOCOL|CONNECTION_(RESET|CLOSED|REFUSED)|EMPTY_RESPONSE|BLOCKED/.test(code)) {
        throw new BlockedError(`사이트가 연결을 끊었습니다 — 자동 접근 차단으로 보입니다 (${code})`);
      }
      if (code === "ERR_NAME_NOT_RESOLVED") throw new Error("사이트 주소를 찾을 수 없습니다");
      if (/Timeout/i.test(e.message)) throw new Error("페이지가 45초 안에 열리지 않았습니다");
      throw new Error(`페이지를 열지 못했습니다${code ? ` (${code})` : ""}`);
    });
    // 자바스크립트가 상품 정보를 그릴 시간을 잠깐 줌
    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
    const html = await page.content();
    const status = res?.status() ?? 200;
    if (looksBlocked(html, status)) throw new BlockedError(`브라우저로 열어도 사이트가 자동 접근을 차단했습니다 (HTTP ${status})`);
    if (status >= 400) throw new Error(`페이지를 불러오지 못했습니다 (HTTP ${status})`);
    const d = await analyzePage(html, page.url(), opts, (u) =>
      page
        .evaluate(async (target) => {
          const r = await fetch(target, { headers: { Accept: "application/json" } });
          return { status: r.status, text: await r.text() };
        }, u)
        .catch(() => null),
    );
    return { ...d, source: `${d.source} · 브라우저` };
  } finally {
    await ctx?.close().catch(() => {});
    release();
  }
}
