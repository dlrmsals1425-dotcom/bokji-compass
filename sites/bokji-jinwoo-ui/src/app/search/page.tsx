import type { Metadata } from "next";
import { Suspense } from "react";
import { Search } from "./Search";

export const metadata: Metadata = { title: "서비스 검색" };

export default function SearchPage() {
  return (
    <Suspense fallback={<div className="wrap muted" style={{ padding: 24 }}>불러오는 중…</div>}>
      <Search />
    </Suspense>
  );
}
