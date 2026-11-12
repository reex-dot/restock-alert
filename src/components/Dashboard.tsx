"use client";

import { useCallback, useEffect, useState } from "react";
import { itemMode, type Item, type Mode } from "@/lib/types.ts";
import { formatPrice, timeAgo } from "@/lib/format.ts";
import PriceChart from "./PriceChart.tsx";

interface Status {
  slack: boolean;
  store: "file" | "postgres";
  scheduler: { enabled: boolean; intervalMinutes: number; nextAt: number | null };
  browser: boolean;
}

type StockFilter = "all" | "out" | "in" | "issue";
type PriceFilter = "all" | "target" | "issue";

const TAB_KEY = "restock-tab";

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) location.href = "/login";
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data as T;
}

function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** 재고 알림에서 "확인 필요": 재고 상태를 모르거나 오류 / 가격 추적에서 "확인 필요": 가격을 모르거나 오류 */
const stockIssue = (i: Item) => Boolean(i.lastError) || i.status === "unknown";
const priceIssue = (i: Item) => Boolean(i.lastError) || i.price == null;
const atTarget = (i: Item) => i.targetPrice != null && i.price != null && i.price <= i.targetPrice;

export default function Dashboard() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [tab, setTabState] = useState<Mode>("stock");
  const [stockFilter, setStockFilter] = useState<StockFilter>("all");
  const [priceFilter, setPriceFilter] = useState<PriceFilter>("all");
  const [, setTick] = useState(0);

  const setTab = (m: Mode) => {
    setTabState(m);
    try {
      localStorage.setItem(TAB_KEY, m);
    } catch {
      /* 저장 불가 환경 */
    }
  };

  const load = useCallback(async () => {
    try {
      const r = await api<{ items: Item[] }>("/api/items");
      setItems(r.items);
    } catch {
      setItems((prev) => prev ?? []);
    }
  }, []);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(TAB_KEY);
      if (saved === "price" || saved === "stock") setTabState(saved);
    } catch {
      /* 무시 */
    }
    load();
    api<Status>("/api/status").then(setStatus).catch(() => {});
    const id = setInterval(() => {
      load();
      setTick((t) => t + 1);
    }, 60_000);
    return () => clearInterval(id);
  }, [load]);

  const replace = (it: Item) => setItems((prev) => (prev ?? []).map((x) => (x.id === it.id ? it : x)));
  const remove = (id: string) => setItems((prev) => (prev ?? []).filter((x) => x.id !== id));

  const all = items ?? [];
  const stockItems = all.filter((i) => itemMode(i) === "stock");
  const priceItems = all.filter((i) => itemMode(i) === "price");
  const list = tab === "stock" ? stockItems : priceItems;

  const shown =
    tab === "stock"
      ? stockItems.filter((i) =>
          stockFilter === "all" ? true : stockFilter === "out" ? i.status === "out_of_stock" : stockFilter === "in" ? i.status === "in_stock" : stockIssue(i),
        )
      : priceItems.filter((i) => (priceFilter === "all" ? true : priceFilter === "target" ? atTarget(i) : priceIssue(i)));

  return (
    <main className="wrap">
      <header className="header">
        <div>
          <h1>재고 알리미</h1>
          <p>품절 상품의 재입고, 관심 상품의 가격 변동을 알려드려요.</p>
        </div>
        <StatusPills status={status} />
      </header>

      <div className="modes" role="tablist">
        <button role="tab" aria-selected={tab === "stock"} className={`mode ${tab === "stock" ? "on" : ""}`} onClick={() => setTab("stock")}>
          <span className="mode-title">📦 재고 알림</span>
          <span className="mode-sub">품절 → 재입고되면 알림 · {stockItems.length}개</span>
        </button>
        <button role="tab" aria-selected={tab === "price"} className={`mode ${tab === "price" ? "on" : ""}`} onClick={() => setTab("price")}>
          <span className="mode-title">💰 가격 추적</span>
          <span className="mode-sub">목표가·가격 하락 알림 · {priceItems.length}개</span>
        </button>
      </div>

      <AddForm key={tab} mode={tab} onAdded={(it) => setItems((prev) => [it, ...(prev ?? [])])} />

      {list.length > 0 && (
        <div className="summary">
          {tab === "stock"
            ? (
                [
                  ["all", "전체", stockItems.length],
                  ["out", "품절", stockItems.filter((i) => i.status === "out_of_stock").length],
                  ["in", "재고 있음", stockItems.filter((i) => i.status === "in_stock").length],
                  ["issue", "확인 필요", stockItems.filter(stockIssue).length],
                ] as [StockFilter, string, number][]
              ).map(([k, label, n]) => (
                <button key={k} className={`tab ${stockFilter === k ? "on" : ""}`} onClick={() => setStockFilter(k)}>
                  {label} {n}
                </button>
              ))
            : (
                [
                  ["all", "전체", priceItems.length],
                  ["target", "목표가 도달", priceItems.filter(atTarget).length],
                  ["issue", "가격 확인 필요", priceItems.filter(priceIssue).length],
                ] as [PriceFilter, string, number][]
              ).map(([k, label, n]) => (
                <button key={k} className={`tab ${priceFilter === k ? "on" : ""}`} onClick={() => setPriceFilter(k)}>
                  {label} {n}
                </button>
              ))}
        </div>
      )}

      <section className="list">
        {items === null && <div className="empty">불러오는 중…</div>}
        {items && list.length === 0 && (
          <div className="card empty">
            <b>{tab === "stock" ? "재고를 기다리는 상품이 없어요" : "가격을 추적하는 상품이 없어요"}</b>
            {tab === "stock" ? "품절된 상품 페이지 주소를 위에 붙여넣어 보세요." : "관심 있는 상품 주소를 붙여넣고 목표가를 정해 보세요."}
          </div>
        )}
        {list.length > 0 && shown.length === 0 && <div className="empty">해당하는 상품이 없어요</div>}
        {shown.map((it) =>
          tab === "stock" ? (
            <StockCard key={it.id} item={it} onChange={replace} onRemove={remove} />
          ) : (
            <PriceCard key={it.id} item={it} onChange={replace} onRemove={remove} />
          ),
        )}
      </section>
    </main>
  );
}

function StatusPills({ status }: { status: Status | null }) {
  const [testMsg, setTestMsg] = useState("");
  if (!status) return null;
  async function test() {
    setTestMsg("전송 중…");
    try {
      await api("/api/test-slack", { method: "POST" });
      setTestMsg("전송됨 ✓");
    } catch (e) {
      setTestMsg((e as Error).message);
    }
  }
  return (
    <div className="pills">
      <span className={`pill ${status.slack ? "ok" : "bad"}`}>
        <span className="dot" />
        {status.slack ? "슬랙 연결됨" : "슬랙 미설정"}
        {status.slack && (
          <button onClick={test} title="테스트 알림 보내기">
            {testMsg || "테스트"}
          </button>
        )}
      </span>
      <span className={`pill ${status.scheduler.enabled ? "ok" : ""}`}>
        <span className="dot" />
        {status.scheduler.intervalMinutes}분마다 자동 확인
      </span>
      {status.browser && (
        <span className="pill ok" title="일반 요청으로 판별이 안 되면 설치된 크롬으로 페이지를 열어 다시 확인합니다">
          <span className="dot" />
          크롬 렌더링 사용
        </span>
      )}
    </div>
  );
}

/* ───────────────────────── 등록 폼 ───────────────────────── */

function AddForm({ mode, onAdded }: { mode: Mode; onAdded: (it: Item) => void }) {
  const [url, setUrl] = useState("");
  const [showOpts, setShowOpts] = useState(mode === "price");
  const [targetPrice, setTargetPrice] = useState("");
  const [notifyOnDrop, setNotifyOnDrop] = useState(true);
  const [outKeyword, setOutKeyword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  // 안드로이드 "공유 → 재고 알리미"로 들어온 경우 URL을 채워둠 (탭을 골라 한 번 탭으로 등록)
  useEffect(() => {
    const sp = new URLSearchParams(location.search);
    const shared = sp.get("add");
    if (shared) {
      setUrl(shared);
      setNotice("공유한 상품 주소를 채워뒀어요. 위에서 재고 알림/가격 추적을 고른 뒤 등록하세요.");
    } else if (sp.get("share") === "nourl") {
      setError("공유한 내용에서 상품 주소를 찾지 못했어요. 링크 복사 후 붙여넣어 주세요.");
    }
    if (shared || sp.has("share")) {
      // 탭을 바꿔도 공유된 주소가 남아 있도록 잠시 보관
      try {
        if (shared) sessionStorage.setItem("restock-shared", shared);
      } catch {
        /* 무시 */
      }
      history.replaceState(null, "", "/");
    } else {
      try {
        const kept = sessionStorage.getItem("restock-shared");
        if (kept) {
          setUrl(kept);
          setNotice("공유한 상품 주소를 채워뒀어요.");
        }
      } catch {
        /* 무시 */
      }
    }
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const body =
        mode === "stock"
          ? { url, mode, outKeyword }
          : { url, mode, targetPrice: targetPrice || null, notifyOnDrop };
      const r = await api<{ item: Item }>("/api/items", { method: "POST", body: JSON.stringify(body) });
      onAdded(r.item);
      setUrl("");
      setTargetPrice("");
      setOutKeyword("");
      try {
        sessionStorage.removeItem("restock-shared");
      } catch {
        /* 무시 */
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card add" onSubmit={submit}>
      <div className="add-row">
        <input
          className="input"
          type="url"
          placeholder={mode === "stock" ? "품절된 상품 페이지 주소" : "가격을 지켜볼 상품 페이지 주소"}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          required
        />
        <button className="btn primary" disabled={busy}>
          {busy ? "확인 중…" : mode === "stock" ? "재입고 알림 받기" : "가격 추적 시작"}
        </button>
      </div>

      {mode === "price" ? (
        <div className="opts">
          <div className="field">
            <label>목표가 (이 가격 이하가 되면 알림, 선택)</label>
            <input className="input sm" inputMode="decimal" placeholder="예: 89000" value={targetPrice} onChange={(e) => setTargetPrice(e.target.value)} />
          </div>
          <label className="check">
            <input type="checkbox" checked={notifyOnDrop} onChange={(e) => setNotifyOnDrop(e.target.checked)} />
            가격이 내려갈 때마다 알림
          </label>
        </div>
      ) : (
        <>
          <button type="button" className="toggle-opts" onClick={() => setShowOpts((v) => !v)}>
            {showOpts ? "▾" : "▸"} 판별 옵션
          </button>
          {showOpts && (
            <div className="opts one">
              <div className="field">
                <label>품절 판별 문구 (선택)</label>
                <input className="input sm" placeholder="예: Sold out, 일시품절" value={outKeyword} onChange={(e) => setOutKeyword(e.target.value)} />
                <div className="hint">자동 판별이 "확인 불가"로 나올 때 넣으세요. 이 문구가 페이지에서 사라지면 재입고로 봐요.</div>
              </div>
            </div>
          )}
        </>
      )}
      {notice && <div className="notice">{notice}</div>}
      {error && <div className="error">{error}</div>}
    </form>
  );
}

/* ───────────────────────── 카드 공통 ───────────────────────── */

function useItemActions(item: Item, onChange: (it: Item) => void, onRemove: (id: string) => void) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function run<T>(fn: () => Promise<T>) {
    setBusy(true);
    setErr("");
    try {
      return await fn();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return {
    busy,
    err,
    checkNow: () => run(async () => onChange((await api<{ item: Item }>(`/api/items/${item.id}/check`, { method: "POST" })).item)),
    patch: (body: Record<string, unknown>) =>
      run(async () => onChange((await api<{ item: Item }>(`/api/items/${item.id}`, { method: "PATCH", body: JSON.stringify(body) })).item)),
    del: () =>
      run(async () => {
        if (!confirm("이 상품을 목록에서 삭제할까요? 가격 이력도 함께 지워집니다.")) return;
        await api(`/api/items/${item.id}`, { method: "DELETE" });
        onRemove(item.id);
      }),
  };
}

function Thumb({ item }: { item: Item }) {
  return item.image ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img className="thumb" src={item.image} alt="" referrerPolicy="no-referrer" />
  ) : (
    <div className="thumb empty">🛍️</div>
  );
}

function StatusBadge({ item }: { item: Item }) {
  if (item.lastError && !item.lastCheckedAt) return <span className="badge err">오류</span>;
  if (item.status === "in_stock") return <span className="badge in">● 재고 있음</span>;
  if (item.status === "out_of_stock") return <span className="badge out">● 품절</span>;
  return <span className="badge unknown">재고 확인 불가</span>;
}

function Actions({ item, a, onEdit }: { item: Item; a: ReturnType<typeof useItemActions>; onEdit: () => void }) {
  return (
    <div className="actions">
      <button className="btn sm" onClick={a.checkNow} disabled={a.busy}>
        {a.busy ? "확인 중…" : "지금 확인"}
      </button>
      <button className="btn sm ghost" onClick={onEdit}>
        설정
      </button>
      <button className="btn sm ghost" onClick={() => a.patch({ active: !item.active })} disabled={a.busy}>
        {item.active ? "일시정지" : "재개"}
      </button>
      <button className="btn sm ghost danger" onClick={a.del} disabled={a.busy}>
        삭제
      </button>
    </div>
  );
}

function MetaBasics({ item }: { item: Item }) {
  return (
    <>
      <span>{timeAgo(item.lastCheckedAt)} 확인</span>
      {item.source && !item.lastError && <span title={item.reason ?? ""}>판별: {item.source}</span>}
      {item.useBrowser && <span title="이 상품은 크롬으로 열어서 확인합니다">🌐 크롬</span>}
      {item.lastError && <span className="warn">⚠ {item.lastError}</span>}
    </>
  );
}

/* ───────────────────────── 재고 알림 카드 ───────────────────────── */

function StockCard({ item, onChange, onRemove }: { item: Item; onChange: (it: Item) => void; onRemove: (id: string) => void }) {
  const a = useItemActions(item, onChange, onRemove);
  const [editing, setEditing] = useState(false);
  const unknown = item.status === "unknown" && !item.lastError;

  // 품절이 시작된 시점 (이력에서 마지막으로 품절이 된 지점)
  let outSince: string | null = null;
  if (item.status === "out_of_stock") {
    for (let i = item.history.length - 1; i >= 0; i--) {
      if (item.history[i].status !== "out_of_stock") break;
      outSince = item.history[i].t;
    }
  }

  return (
    <article className={`card item ${item.active ? "" : "paused"}`}>
      <div className="item-top">
        <Thumb item={item} />
        <div className="item-main">
          <a className="item-name" href={item.url} target="_blank" rel="noreferrer">
            {item.name ?? item.url}
          </a>
          <div className="item-sub">
            <StatusBadge item={item} />
            <span>{hostOf(item.url)}</span>
            {!item.active && <span>· 일시정지됨</span>}
          </div>
          {outSince && <div className="since">{timeAgo(outSince).replace(" 전", "")}째 품절 중 — 재입고되면 알려드릴게요</div>}
        </div>
        {item.price != null && (
          <div className="item-price">
            <div className="price small">{formatPrice(item.price, item.currency)}</div>
          </div>
        )}
      </div>

      {unknown && (
        <div className="explain">
          <b>재고 상태를 알 수 없어요.</b> {item.reason}
          <div className="explain-actions">
            <button className="btn sm" onClick={() => setEditing(true)}>
              품절 문구 지정하기
            </button>
            {item.price != null && (
              <button className="btn sm ghost" onClick={() => a.patch({ mode: "price" })} disabled={a.busy}>
                가격 추적으로 옮기기
              </button>
            )}
          </div>
        </div>
      )}

      <div className="item-foot">
        <div className="meta">
          <MetaBasics item={item} />
          {item.outKeyword && <span>문구: “{item.outKeyword}”</span>}
        </div>
        <Actions item={item} a={a} onEdit={() => setEditing((v) => !v)} />
      </div>
      {a.err && <div className="error">{a.err}</div>}
      {editing && (
        <div className="edit">
          <StockEdit item={item} busy={a.busy} onSave={(b) => a.patch(b).then(() => setEditing(false))} onCancel={() => setEditing(false)} />
        </div>
      )}
    </article>
  );
}

function StockEdit({ item, busy, onSave, onCancel }: { item: Item; busy: boolean; onSave: (b: Record<string, unknown>) => void; onCancel: () => void }) {
  const [outKeyword, setOutKeyword] = useState(item.outKeyword ?? "");
  return (
    <>
      <div className="field wide">
        <label>품절 판별 문구</label>
        <input className="input sm" placeholder="비우면 자동 판별 (예: Sold out)" value={outKeyword} onChange={(e) => setOutKeyword(e.target.value)} />
        <div className="hint">상품 페이지에서 품절일 때만 보이는 문구를 그대로 넣으세요. 대소문자는 구분하지 않아요.</div>
      </div>
      <div className="row-end">
        <button className="btn sm ghost" onClick={() => onSave({ mode: "price" })} disabled={busy}>
          가격 추적으로 옮기기
        </button>
        <span className="spacer" />
        <button className="btn sm ghost" onClick={onCancel}>
          취소
        </button>
        <button className="btn sm primary" disabled={busy} onClick={() => onSave({ outKeyword })}>
          저장
        </button>
      </div>
    </>
  );
}

/* ───────────────────────── 가격 추적 카드 ───────────────────────── */

function PriceCard({ item, onChange, onRemove }: { item: Item; onChange: (it: Item) => void; onRemove: (id: string) => void }) {
  const a = useItemActions(item, onChange, onRemove);
  const [editing, setEditing] = useState(false);

  const priced = item.history.filter((p) => p.price != null);
  const prev = priced.length >= 2 ? priced[priced.length - 2].price! : null;
  const delta = prev != null && item.price != null ? item.price - prev : 0;
  const reached = atTarget(item);

  return (
    <article className={`card item ${item.active ? "" : "paused"}`}>
      <div className="item-top">
        <Thumb item={item} />
        <div className="item-main">
          <a className="item-name" href={item.url} target="_blank" rel="noreferrer">
            {item.name ?? item.url}
          </a>
          <div className="item-sub">
            {reached && <span className="badge in">🎯 목표가 도달</span>}
            {item.status === "out_of_stock" && <span className="badge out">품절</span>}
            <span>{hostOf(item.url)}</span>
            {!item.active && <span>· 일시정지됨</span>}
          </div>
        </div>
        <div className="item-price">
          <div className="price">{item.price != null ? formatPrice(item.price, item.currency) : "—"}</div>
          {delta !== 0 && (
            <div className={`price-sub ${delta < 0 ? "delta-down" : "delta-up"}`}>
              {delta < 0 ? "▼" : "▲"} {formatPrice(Math.abs(delta), item.currency)}
            </div>
          )}
          {item.lowestPrice != null && item.highestPrice != null && item.lowestPrice !== item.highestPrice && (
            <div className="price-sub">
              최저 {formatPrice(item.lowestPrice, item.currency)} · 최고 {formatPrice(item.highestPrice, item.currency)}
            </div>
          )}
          {item.targetPrice != null && <div className="price-sub">목표 {formatPrice(item.targetPrice, item.currency)}</div>}
        </div>
      </div>

      {item.price == null && !item.lastError ? (
        <div className="explain">
          <b>이 페이지에서 가격을 찾지 못했어요.</b> 쇼핑몰이 가격을 자바스크립트로만 보여주거나 자동 접근을 막는 경우예요.
        </div>
      ) : (
        <PriceChart history={item.history} currency={item.currency} target={item.targetPrice} />
      )}

      <div className="item-foot">
        <div className="meta">
          <MetaBasics item={item} />
          {item.notifyOnDrop && <span>📉 하락 알림</span>}
        </div>
        <Actions item={item} a={a} onEdit={() => setEditing((v) => !v)} />
      </div>
      {a.err && <div className="error">{a.err}</div>}
      {editing && (
        <div className="edit">
          <PriceEdit item={item} busy={a.busy} onSave={(b) => a.patch(b).then(() => setEditing(false))} onCancel={() => setEditing(false)} />
        </div>
      )}
    </article>
  );
}

function PriceEdit({ item, busy, onSave, onCancel }: { item: Item; busy: boolean; onSave: (b: Record<string, unknown>) => void; onCancel: () => void }) {
  const [targetPrice, setTargetPrice] = useState(item.targetPrice?.toString() ?? "");
  const [notifyOnDrop, setNotifyOnDrop] = useState(item.notifyOnDrop);
  return (
    <>
      <div className="field">
        <label>목표가</label>
        <input className="input sm" inputMode="decimal" placeholder="비우면 사용 안 함" value={targetPrice} onChange={(e) => setTargetPrice(e.target.value)} />
      </div>
      <label className="check">
        <input type="checkbox" checked={notifyOnDrop} onChange={(e) => setNotifyOnDrop(e.target.checked)} />
        가격이 내려갈 때마다 알림
      </label>
      <div className="row-end">
        <button className="btn sm ghost" onClick={() => onSave({ mode: "stock" })} disabled={busy}>
          재고 알림으로 옮기기
        </button>
        <span className="spacer" />
        <button className="btn sm ghost" onClick={onCancel}>
          취소
        </button>
        <button className="btn sm primary" disabled={busy} onClick={() => onSave({ targetPrice: targetPrice || null, notifyOnDrop })}>
          저장
        </button>
      </div>
    </>
  );
}
