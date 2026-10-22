"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { setSettings, useSettings } from "@/lib/client/storage";
import { Icon } from "./Icon";
import styles from "./SiteChrome.module.css";

// (2026-10-22 외부 점검 P2-3) 서비스 검색이 어디에도 연결되지 않던 것 — 홈(지도 랜딩)·찾기 화면 밖의 주 메뉴에
const NAV = [
  { href: "/results", label: "내 결과" },
  { href: "/search", label: "서비스 검색" },
];

/** 파비콘·앱 아이콘과 같은 원본. 이름은 옆 글자와 홈 링크가 전달한다. */
export function LogoMark() {
  // eslint-disable-next-line @next/next/no-img-element -- 벡터 로고: 최적화 불필요, rem 크기로 '글자 크게'와 함께 커짐
  return <img className="logo-symbol" src="/brand/logo-symbol.svg?v=compass-1" alt="" aria-hidden="true" width={27} height={27} />;
}

export function SiteHeader() {
  const path = usePathname();
  const finding = path === "/ask" || path === "/situation";
  const landing = path === "/";
  const settings = useSettings();
  const large = settings?.large ?? false;
  const nav = (cls: string) => (
    <nav className={cls} aria-label={cls === "mnav" ? "주 메뉴(모바일)" : "주 메뉴"}>
      {NAV.map((n) => (
        <Link key={n.href} href={n.href} aria-current={path === n.href ? "page" : undefined}>
          {n.label}
        </Link>
      ))}
    </nav>
  );
  return (
      <header className={`site-header ${styles.header} ${finding || landing ? styles.focused : ""} ${landing ? styles.landing : ""}`}>
        <div className="wrap">
          <Link href="/" className="logo" aria-label="복지나침반 홈">
            <LogoMark />
            <span className={styles.wordmark}>복지나침반</span>
          </Link>
          {!finding && !landing && nav("header-nav")}
          <div className="header-actions">
            {/* 켜고 끄는 단추: 이름은 늘 '글자 크게', 켜져 있으면 진한 바탕과 ✓ (2026-10-22: 켜진 채 '글자 보통'이 보여 반대로 읽힘) */}
            <button type="button" className="btn btn-sm toggle" aria-pressed={large} onClick={() => setSettings({ large: !large })} data-testid="large-text">
              {large && <Icon name="check" size={14} />} 글자 크게
            </button>
          </div>
        </div>
        {!finding && !landing && nav("mnav")}
      </header>
  );
}
