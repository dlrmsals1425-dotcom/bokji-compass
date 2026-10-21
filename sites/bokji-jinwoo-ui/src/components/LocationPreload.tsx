"use client";
import { useEffect } from "react";
import { suggestLocation } from "@/lib/client/locationSuggestion";

/** 첫 화면을 보는 동안 위치 권한·시군구 조회를 미리 시작한다. */
export function LocationPreload() {
  useEffect(() => { void suggestLocation(); }, []);
  return null;
}
