import type { Metadata } from "next";
import { Suspense } from "react";
import { SituationEntry } from "./SituationEntry";

export const metadata: Metadata = { title: "말로 찾기" };

export default function SituationPage() {
  return (
    <Suspense fallback={<div className="narrow page muted">불러오는 중…</div>}>
      <SituationEntry />
    </Suspense>
  );
}
