"use client";
import { useRouter } from "next/navigation";
import { Icon } from "./Icon";
import { loadRegions } from "@/lib/client/bundles";
import { parseSituation, prefillPath, savePrefill } from "@/lib/client/parse";

/**
 * 홈 검색창: 서비스 이름이면 검색으로, 상황 문장(지역·나이·가족 낱말)이면 맞춤 입력으로 (해석 결과는 이 기기 sessionStorage에만).
 * 자바스크립트가 없으면 그대로 /search?q= 로 간다.
 */
export function HomeSearch() {
  const router = useRouter();
  return (
    <form
      action="/search"
      role="search"
      className="hero-search"
      onSubmit={async (e) => {
        const q = String(new FormData(e.currentTarget).get("q") ?? "").trim();
        if (!q) return;
        e.preventDefault();
        const regions = await loadRegions().catch(() => null);
        const parsed = parseSituation(q, regions);
        if (parsed.looksLikeSituation) {
          savePrefill(q, parsed);
          router.push(prefillPath(parsed));
        } else {
          router.push(`/search?q=${encodeURIComponent(q)}`);
        }
      }}
    >
      <label htmlFor="home-q" className="sr-only">
        혜택 이름으로 찾기
      </label>
      <input id="home-q" name="q" type="search" placeholder="혜택 검색 · 예: 기초연금, 월세" autoComplete="off" />
      <button type="submit" aria-label="검색">
        <Icon name="search" size={22} strokeWidth={2.2} />
      </button>
    </form>
  );
}
