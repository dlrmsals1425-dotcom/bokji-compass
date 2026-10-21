import type { Metadata } from "next";
import { Suspense } from "react";
import { EasyResults } from "./EasyResults";

export const metadata: Metadata = { title: "쉬운 찾기 결과" };

export default function EasyResultsPage() {
  return (
    <Suspense fallback={<div className="wrap page muted">불러오는 중…</div>}>
      <EasyResults />
    </Suspense>
  );
}
