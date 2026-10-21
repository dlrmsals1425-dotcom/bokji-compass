"use client";
/**
 * /check: 기본 입력은 '상황 먼저' 화면(/situation)으로 보낸다 (?for= · ?prefill=1 유지 — 예전 링크 호환).
 * ?v=1 이면 예전 단계별 입력 (비교용).
 */
import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Wizard } from "./Wizard";

export function CheckEntry() {
  const params = useSearchParams();
  const router = useRouter();
  const v1 = params.get("v") === "1";
  useEffect(() => {
    if (v1) return;
    const q = new URLSearchParams();
    const f = params.get("for");
    if (f === "self" || f === "parent") q.set("for", f);
    if (params.get("prefill") === "1") q.set("prefill", "1");
    const s = q.toString();
    router.replace(s ? `/situation?${s}` : "/situation");
  }, [v1, params, router]);
  if (v1) return <Wizard />;
  return <div className="narrow page muted">입력 화면으로 옮기는 중…</div>;
}
