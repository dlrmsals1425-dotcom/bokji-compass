import type { Metadata, Viewport } from "next";
// Pretendard v1.3.9 (SIL OFL 1.1, fonts/…/LICENSE.txt) — 사이트 안에 둔 동적 서브셋: 외부 CDN 연결 없이 쓰는 글자 조각만 받음 (결정 6b)
import "./fonts/pretendard-1.3.9/pretendardvariable-dynamic-subset.css";
import "./globals.css";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";

const SITE = "https://bokji-jinwoo-ui.nutmeg-frog-5006.chatgpt.site";
const DESC =
  "내 상황에 맞는 전국 복지 혜택과 신청 방법을 찾아보세요.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: { default: "복지나침반", template: "%s · 복지나침반" },
  description: DESC,
  openGraph: {
    type: "website",
    locale: "ko_KR",
    siteName: "복지나침반",
    title: "복지나침반",
    description: DESC,
    images: [{ url: "/icons/icon-512.png?v=compass-1", width: 512, height: 512, alt: "복지나침반" }],
  },
  twitter: { card: "summary", images: ["/icons/icon-512.png?v=compass-1"] },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#fbfcf8",
  width: "device-width",
  initialScale: 1,
};

/** 큰 글씨 설정을 첫 페인트 전에 적용 (깜빡임 방지) */
const settingsBootstrap = `try{var s=JSON.parse(localStorage.getItem('bn.settings.v1')||'{}');if(s.large)document.documentElement.dataset.large='1'}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: settingsBootstrap }} />
      </head>
      <body>
        <a className="skip" href="#main">
          본문 바로가기
        </a>
        <SiteHeader />
        <main id="main">{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}
