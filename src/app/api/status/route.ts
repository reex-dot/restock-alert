import { NextResponse } from "next/server";
import { isSlackConfigured } from "@/lib/notify.ts";
import { storeKind } from "@/lib/store.ts";
import { schedulerInfo } from "@/lib/scheduler.ts";
import { browserAvailable } from "@/lib/browser.ts";

export async function GET() {
  return NextResponse.json({ slack: isSlackConfigured(), store: storeKind(), scheduler: schedulerInfo(), browser: browserAvailable() });
}
