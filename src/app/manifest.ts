import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "재고 알리미",
    short_name: "재고알리미",
    description: "품절 상품의 재입고와 가격 변동을 슬랙으로 알려드립니다.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#141413",
    theme_color: "#141413",
    lang: "ko",
    icons: [
      { src: "/icons/192", sizes: "192x192", type: "image/png" },
      { src: "/icons/512", sizes: "512x512", type: "image/png" },
      { src: "/icons/512?maskable=1", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    // 안드로이드 "공유" 메뉴에 재고 알리미가 뜨게 함 → 쇼핑몰 앱·크롬에서 상품 링크를 바로 보낼 수 있음
    share_target: {
      action: "/share",
      method: "GET",
      params: { title: "title", text: "text", url: "url" },
    },
  } as MetadataRoute.Manifest;
}
