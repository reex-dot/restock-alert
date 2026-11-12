import type { Metadata, Viewport } from "next";
import RegisterSW from "@/components/RegisterSW.tsx";
import "./globals.css";

export const metadata: Metadata = {
  title: "재고 알리미",
  description: "품절 상품의 재입고와 가격 변동을 슬랙으로 알려드립니다.",
  icons: { icon: "/icons/192", apple: "/icons/192" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f5f1" },
    { media: "(prefers-color-scheme: dark)", color: "#141413" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>
        {children}
        <RegisterSW />
      </body>
    </html>
  );
}
