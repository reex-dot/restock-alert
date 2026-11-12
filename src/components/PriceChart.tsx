"use client";

import { useMemo, useState } from "react";
import type { PricePoint } from "@/lib/types.ts";
import { formatPrice } from "@/lib/format.ts";

const W = 600;
const H = 92;
const PAD_Y = 10;

/** 가격 이력 계단형 그래프. 품절 구간은 붉은 띠로, 목표가는 점선으로 표시합니다. */
export default function PriceChart({ history, currency, target }: { history: PricePoint[]; currency: string | null; target: number | null }) {
  const [hover, setHover] = useState<number | null>(null);
  const pts = useMemo(() => history.filter((p) => p.price != null) as (PricePoint & { price: number })[], [history]);

  const geo = useMemo(() => {
    if (pts.length < 2) return null;
    const t0 = new Date(pts[0].t).getTime();
    const t1 = Math.max(Date.now(), new Date(pts[pts.length - 1].t).getTime());
    const prices = pts.map((p) => p.price);
    if (target != null) prices.push(target);
    let lo = Math.min(...prices);
    let hi = Math.max(...prices);
    if (lo === hi) {
      lo *= 0.95;
      hi *= 1.05;
    }
    const x = (t: number) => ((t - t0) / Math.max(1, t1 - t0)) * W;
    const y = (p: number) => PAD_Y + (1 - (p - lo) / (hi - lo)) * (H - PAD_Y * 2);
    const coords = pts.map((p) => ({ x: x(new Date(p.t).getTime()), y: y(p.price), p }));
    let d = `M${coords[0].x},${coords[0].y}`;
    for (let i = 1; i < coords.length; i++) d += ` H${coords[i].x} V${coords[i].y}`;
    d += ` H${W}`;
    const area = `${d} V${H} H${coords[0].x} Z`;

    // 품절 구간 (가격 없는 점 포함 전체 이력 기준)
    const bands: { x0: number; x1: number }[] = [];
    let start: number | null = null;
    for (const p of history) {
      const px = x(new Date(p.t).getTime());
      if (p.status === "out_of_stock" && start == null) start = px;
      if (p.status !== "out_of_stock" && start != null) {
        bands.push({ x0: start, x1: px });
        start = null;
      }
    }
    if (start != null) bands.push({ x0: start, x1: W });

    return { coords, d, area, bands, targetY: target != null ? y(target) : null };
  }, [pts, history, target]);

  if (!geo) {
    return <div className="chart-empty">가격 이력이 쌓이면 그래프가 표시됩니다</div>;
  }

  const h = hover != null ? geo.coords[hover] : null;

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    const mx = ((e.clientX - r.left) / r.width) * W;
    let best = 0;
    for (let i = 0; i < geo!.coords.length; i++) if (geo!.coords[i].x <= mx) best = i;
    setHover(best);
  }

  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" onMouseMove={onMove} onMouseLeave={() => setHover(null)} role="img" aria-label="가격 변동 그래프">
        {geo.bands.map((b, i) => (
          <rect key={i} x={b.x0} y={0} width={Math.max(1, b.x1 - b.x0)} height={H} fill="var(--out-bg)" />
        ))}
        <path d={geo.area} fill="var(--line-fill)" />
        <path d={geo.d} fill="none" stroke="var(--line)" strokeWidth={2} vectorEffect="non-scaling-stroke" />
        {geo.targetY != null && (
          <line x1={0} x2={W} y1={geo.targetY} y2={geo.targetY} stroke="var(--target)" strokeDasharray="5 4" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        )}
        {h && <line x1={h.x} x2={h.x} y1={0} y2={H} stroke="var(--muted)" strokeWidth={1} vectorEffect="non-scaling-stroke" />}
      </svg>
      {h && (
        <div className="tip" style={{ left: `${(h.x / W) * 100}%`, top: `${(h.y / H) * 92 - 6}px` }}>
          {formatPrice(h.p.price, currency)} · {new Date(h.p.t).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}
          {h.p.status === "out_of_stock" ? " · 품절" : ""}
        </div>
      )}
    </div>
  );
}
