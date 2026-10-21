"use client";
import Link from "next/link";
import { useMode, useProfile } from "@/lib/client/storage";
import { resultsPath } from "@/lib/client/mode";
import { Icon } from "./Icon";

/** 이 기기에 저장된 입력이 있으면 '이어서 보기' */
export function ResumeBanner() {
  const p = useProfile();
  const mode = useMode();
  if (!p) return null;
  const parent = mode === "parent";
  return (
    <Link href={resultsPath(mode ?? "self")}>{parent ? "부모님 " : ""}지난 결과 보기 <Icon name="arrowRight" size={16} /></Link>
  );
}
