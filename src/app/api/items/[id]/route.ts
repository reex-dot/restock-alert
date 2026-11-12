import { NextResponse } from "next/server";
import { store } from "@/lib/store.ts";
import { parseOptionalPrice } from "@/lib/validate.ts";

export async function PATCH(req: Request, ctx: RouteContext<"/api/items/[id]">) {
  const { id } = await ctx.params;
  const item = await store.get(id);
  if (!item) return NextResponse.json({ error: "not found" }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  try {
    if ("active" in body) item.active = Boolean(body.active);
    if (body.mode === "stock" || body.mode === "price") {
      // 재고 상태 이력은 모드와 상관없이 계속 쌓이므로 옮겨도 재입고 판단이 그대로 이어짐
      item.mode = body.mode;
    }
    if ("notifyOnDrop" in body) item.notifyOnDrop = Boolean(body.notifyOnDrop);
    if ("targetPrice" in body) item.targetPrice = parseOptionalPrice(body.targetPrice);
    if ("outKeyword" in body) {
      const kw = typeof body.outKeyword === "string" ? body.outKeyword.trim() : "";
      if ((kw || null) !== item.outKeyword) item.lastDefiniteStatus = null; // 판별 기준이 바뀌면 재입고 기준점도 초기화
      item.outKeyword = kw || null;
    }
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
  await store.save(item);
  return NextResponse.json({ item });
}

export async function DELETE(_req: Request, ctx: RouteContext<"/api/items/[id]">) {
  const { id } = await ctx.params;
  await store.remove(id);
  return NextResponse.json({ ok: true });
}
