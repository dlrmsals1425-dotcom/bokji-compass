import fs from "node:fs";
import type { SourceRecord } from "./record";
import { isEupmyeondongLevel } from "./record";
import { cleanName, cleanText, nameKey } from "../normalize/names";
import { icareCategory } from "../normalize/categories";
import type { RegionIndex } from "../normalize/regions";
import { extractFromText } from "../rules/fromText";

/**
 * 보건복지부 통합돌봄 '지방정부 서비스 메뉴판' (선행 대시보드 수집본 policies.csv, 12,526행, 원문 기준 2026-04 등).
 * 시도 표기는 display_sido(전남광주 통합) 기준. 시군구 칸이 시도명인 행(제주·세종)은 시도/단층 사업.
 */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else q = false;
      } else field += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== "\r") field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [head, ...body] = rows;
  const h = head.map((x) => x.replace(/^\uFEFF/, ""));
  return body.filter((r) => r.length > 1).map((r) => Object.fromEntries(h.map((k, i) => [k, r[i] ?? ""])));
}

const PUBLIC_INST = /(국민건강보험공단|건강보험공단|건보|국민연금공단|근로복지공단|공단|한국장애인고용공단|LH|주택도시보증공사)/;

export function loadIcare(csvPath: string, fetchedAt: string, regions: RegionIndex, log: (m: string) => void): SourceRecord[] {
  const rows = parseCsv(fs.readFileSync(csvPath, "utf8"));
  const out: SourceRecord[] = [];
  let unmapped = 0;
  for (const r of rows) {
    const sido = regions.sido(r.display_sido || r.sido);
    if (!sido) { unmapped++; continue; }
    const name = cleanName(r.name);
    let scope: SourceRecord["scope"];
    let sigunguCodes: string[] | undefined;
    let regionLabel: string;
    if (r.sigungu === r.sido || r.sigungu === r.display_sido) {
      if (sido.code === "36000") { scope = "sigungu"; sigunguCodes = ["36110"]; regionLabel = "세종"; }
      else { scope = "sido"; regionLabel = sido.name; }
    } else {
      const sggs = regions.resolveSigungu(sido.name, r.sigungu);
      if (sggs.length === 0) { unmapped++; log(`[icare] 시군구 매핑 실패: ${r.display_sido} ${r.sigungu}`); continue; }
      scope = "sigungu";
      sigunguCodes = sggs.map((s) => s.code);
      regionLabel = `${sido.short} ${sggs.map((s) => s.name).join("·")}`;
    }
    const provider = cleanText(r.provider);
    let orgType: SourceRecord["orgType"] = "local";
    if (r.type === "광역" || r.type === "경기도" || scope === "sido") orgType = "metro";
    if (provider && PUBLIC_INST.test(provider)) orgType = "public_inst";

    const targetText = [r.target, r.detailTarget].filter(Boolean).join(" / ");
    const tx = extractFromText(targetText);
    const rec: SourceRecord = {
      source: "icare",
      sourceId: r.serviceId,
      name,
      key: nameKey(r.program_key || name),
      summary: cleanText(r.description) ?? "",
      target: cleanText(r.detailTarget && r.detailTarget !== r.target ? `${r.target} (${r.detailTarget})` : r.target),
      orgType,
      scope,
      sidoCode: sido.code,
      sigunguCodes,
      regionLabel,
      owner: r.type === "전국" ? "중앙부처 (전국 공통 사업)" : regionLabel,
      provider,
      category: icareCategory(r.category, r.service_concept, r.service_concept_label),
      tags: [r.subcategory, r.service_concept_label].filter((x) => x && x !== "기타/미분류"),
      url: r.detailUrl || undefined,
      updatedAt: r.updatedDate || undefined,
      fetchedAt,
      trust: "B",
      badges: [],
      draft: { origin: tx.logic ? "text_extract" : "none", logic: tx.logic, unstructured: tx.unstructured, core: tx.core },
      icareType: r.type,
    };
    if (isEupmyeondongLevel(name, r.sigungu)) rec.excluded = "eupmyeondong_level";
    out.push(rec);
  }
  if (unmapped) log(`[icare] 지역 매핑 실패로 제외: ${unmapped}건`);
  return out;
}
