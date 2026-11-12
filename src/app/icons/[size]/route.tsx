import { ImageResponse } from "next/og";

/** 홈 화면 아이콘 (192/512px PNG). maskable=1이면 안드로이드 원형 마스크용으로 여백을 더 둠 */
export async function GET(req: Request, ctx: RouteContext<"/icons/[size]">) {
  const { size: raw } = await ctx.params;
  const size = raw === "192" ? 192 : 512;
  const maskable = new URL(req.url).searchParams.has("maskable");
  const bell = Math.round(size * (maskable ? 0.46 : 0.6));
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#2f5bea",
          borderRadius: maskable ? 0 : size * 0.22,
        }}
      >
        <svg width={bell} height={bell} viewBox="0 0 24 24" fill="none">
          <path d="M12 2.5a6 6 0 0 0-6 6v3.6l-1.7 3.1A1 1 0 0 0 5.2 16.7h13.6a1 1 0 0 0 .9-1.5L18 12.1V8.5a6 6 0 0 0-6-6Z" fill="#ffffff" />
          <path d="M9.5 18.5a2.5 2.5 0 0 0 5 0" stroke="#ffffff" strokeWidth="1.8" strokeLinecap="round" />
          <circle cx="18" cy="5.5" r="3.2" fill="#5cc98a" stroke="#2f5bea" strokeWidth="1.4" />
        </svg>
      </div>
    ),
    { width: size, height: size, headers: { "Cache-Control": "public, max-age=604800, immutable" } },
  );
}
