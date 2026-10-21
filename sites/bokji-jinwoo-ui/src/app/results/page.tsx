import type { Metadata } from "next";
import { Suspense } from "react";
import { Results } from "./Results";

export const metadata: Metadata = { title: "내 결과" };

export default function ResultsPage() {
  return (
    <Suspense fallback={<div className="wrap page muted">불러오는 중…</div>}>
      <Results />
    </Suspense>
  );
}
