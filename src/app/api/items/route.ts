import { NextResponse } from "next/server";
import { store } from "@/lib/store.ts";
import { checkItem, newItem } from "@/lib/checker.ts";
import { parseOptionalPrice, validateProductUrl } from "@/lib/validate.ts";
import { itemMode, type Mode } from "@/lib/types.ts";

export async function GET() {
  const items = await store.list();
  items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return NextResponse.json({ items });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  try {
    const url = validateProductUrl(body.url);
    const mode: Mode = body.mode === "price" ? "price" : "stock";
    // 같은 상품을 재고 알림과 가격 추적에 각각 하나씩은 등록할 수 있음
    const existing = (await store.list()).find((i) => i.url === url && itemMode(i) === mode);
    if (existing) {
      return NextResponse.json({ error: `이미 ${mode === "price" ? "가격 추적" : "재고 알림"}에 등록된 상품입니다.` }, { status: 409 });
    }
    const item = newItem(url, {
      mode,
      outKeyword: typeof body.outKeyword === "string" ? body.outKeyword : null,
      targetPrice: parseOptionalPrice(body.targetPrice),
      notifyOnDrop: Boolean(body.notifyOnDrop),
    });
    await store.save(item);
    // 등록 즉시 1회 확인해서 상품명·가격·현재 상태를 채움
    const checked = await checkItem(item);
    return NextResponse.json({ item: checked }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
