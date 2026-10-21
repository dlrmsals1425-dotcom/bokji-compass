import type { Metadata } from "next";
import { env } from "cloudflare:workers";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { Detail } from "./Detail";
import { detailBucket } from "@/lib/data/bucket";
import { normalizeText } from "@/lib/data/text";

/** 상세 주소의 사업 (공개 번들 샤드에서 읽음 — 상황 정보는 쓰지 않음). 읽기 실패는 null(=모름) */
async function lookup(id: string): Promise<{ name: string; summary?: string } | null | "missing"> {
  if (!/^(n\.|[sg]\d{5}\.)[\w.-]+$/.test(id)) return "missing";
  try {
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host");
    if (!host) return null;
    const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
    const assetUrl = `${proto}://${host}/bundles/v1/details/${detailBucket(id)}.json`;
    // Read bundled data inside the Worker; private Sites must not self-fetch
    // through the external ChatGPT sign-in boundary.
    const r = env.ASSETS
      ? await env.ASSETS.fetch(new Request(assetUrl))
      : await fetch(assetUrl, { cache: "force-cache" });
    if (!r.ok) return null;
    const shard = (await r.json()) as Record<string, { name: string; summary?: string }>;
    return shard[id] ?? "missing";
  } catch {
    return null;
  }
}

type ProgramPageProps = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: ProgramPageProps): Promise<Metadata> {
  const { id } = await params;
  const p = await lookup(decodeURIComponent(id));
  // QA 2차 N8: 없는 서비스는 문서 제목도 '찾을 수 없는 페이지'
  if (p === "missing") return { title: "찾을 수 없는 페이지" };
  if (!p) return { title: "서비스 상세" };
  const name = normalizeText(p.name);
  const desc = p.summary ? normalizeText(p.summary).slice(0, 120) : `${name} — 지원 대상·신청 방법`;
  return { title: name, description: desc, openGraph: { title: `${name} · 복지나침반`, description: desc } };
}

export default async function ProgramPage({ params }: ProgramPageProps) {
  const { id } = await params;
  const pid = decodeURIComponent(id);
  // 없는 사업 주소는 404 (QA 1차 M5) — 번들을 못 읽은 경우(null)는 화면에서 다시 시도
  if ((await lookup(pid)) === "missing") notFound();
  return <Detail id={pid} />;
}
