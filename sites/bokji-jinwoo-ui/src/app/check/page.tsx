import { Suspense } from "react";
import type { Metadata } from "next";
import { CheckEntry } from "./CheckEntry";

export const metadata: Metadata = { title: "맞춤 찾기" };

export default function CheckPage() {
  return (
    <Suspense fallback={<div className="narrow page muted">불러오는 중…</div>}>
      <CheckEntry />
    </Suspense>
  );
}
