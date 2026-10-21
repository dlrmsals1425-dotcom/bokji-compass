import type { Metadata, Viewport } from "next";
// Pretendard v1.3.9 (SIL OFL 1.1, fonts/…/LICENSE.txt) — 사이트 안에 둔 동적 서브셋: 외부 CDN 연결 없이 쓰는 글자 조각만 받음 (결정 6b)
import "./fonts/pretendard-1.3.9/pretendardvariable-dynamic-subset.css";
import "./globals.css";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { KioskGuard } from "@/components/KioskGuard";

const SITE = process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "https://bokji-compass.vercel.app";
const DESC =
  "상황을 한 문장으로 적거나 몇 가지만 답하면 중앙정부·시도·시군구·공공기관 복지 중 받으실 수 있는 혜택, 신청할 때 확인할 혜택, 신청할 곳을 이유와 함께 알려드려요. 로그인 없이, 복지 판정은 이 기기에서 해요.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: { default: "복지나침반 — 로그인 없이 찾는 맞춤 복지", template: "%s · 복지나침반" },
  description: DESC,
  openGraph: {
    type: "website",
    locale: "ko_KR",
    siteName: "복지나침반",
    title: "복지나침반 — 로그인 없이 찾는 맞춤 복지",
    description: "받으실 수 있는 복지 혜택과 신청할 곳을 이유와 함께. 복지 판정은 이 기기에서 해요.",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "복지나침반 — 로그인 없이 찾는 맞춤 복지" }],
  },
  twitter: { card: "summary_large_image", images: ["/og.png"] },
  // 검색 노출 허용 (QA 1차 M5) — 미리보기 환경(preview)은 그대로 막는다
  robots: process.env.VERCEL_ENV && process.env.VERCEL_ENV !== "production" ? { index: false, follow: false } : { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: "#fbfcf8",
  width: "device-width",
  initialScale: 1,
};

/** 큰 글씨 설정을 첫 페인트 전에 적용 (깜빡임 방지) */
const settingsBootstrap = `try{var s=JSON.parse(localStorage.getItem('bn.settings.v1')||'{}');if(s.large)document.documentElement.dataset.large='1';if(s.kiosk)document.documentElement.setAttribute('data-kiosk','1')}catch(e){}`;

export default function RootLayout({ children }: LayoutProps<"/">) {
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
        <KioskGuard />
      </body>
    </html>
  );
}
