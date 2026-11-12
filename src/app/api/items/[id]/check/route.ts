import { NextResponse } from "next/server";
import { store } from "@/lib/store.ts";
import { checkItem, needsBrowserElsewhere } from "@/lib/checker.ts";

export async function POST(_req: Request, ctx: RouteContext<"/api/items/[id]/check">) {
  const { id } = await ctx.params;
  const item = await store.get(id);
  if (!item) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (needsBrowserElsewhere(item)) {
    return NextResponse.json(
      { error: "이 상품은 크롬으로만 확인돼서 30분마다 자동으로 갱신돼요. 지금 바로 확인할 수는 없어요.", item },
      { status: 409 },
    );
  }
  return NextResponse.json({ item: await checkItem(item) });
}
