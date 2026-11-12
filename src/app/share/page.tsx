import { redirect } from "next/navigation";
import { extractSharedUrl } from "@/lib/share.ts";

export default async function SharePage({ searchParams }: PageProps<"/share">) {
  const sp = await searchParams;
  const pick = (k: string) => (Array.isArray(sp[k]) ? sp[k][0] : sp[k]) as string | undefined;
  const url = extractSharedUrl(pick("url"), pick("text"), pick("title"));
  redirect(url ? `/?add=${encodeURIComponent(url)}` : "/?share=nourl");
}
