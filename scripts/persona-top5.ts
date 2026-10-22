/**
 * 페르소나 상위 5개 (판정·파서·데이터를 바꿀 때 회귀 확인용): 홈 예시 상황 + 문장 26개를 지금 번들로 판정해 '먼저 확인할 5가지' 이름을 JSON으로.
 * 날짜는 2026-10-09로 고정 (문장 해석의 나이 계산이 날마다 바뀌지 않게). 사이트 데이터 자동 재생성(.github/workflows/data-rebuild.yml)이 전후를 비교한다.
 * 사용: npx tsx scripts/persona-top5.ts <출력.json>
 */
import fs from "node:fs";
import path from "node:path";
import { parseSituation, parsedExtras } from "../src/lib/client/parse";
import { EMPTY_EXTRAS, buildView, scoreV2, topPicksV2, type Situation } from "../src/lib/client/v2";
import { situationOf } from "../src/lib/client/start";
import { PRESETS } from "../src/lib/client/presets";
import { refineProgram } from "../src/lib/data/refine";
import { EMPTY_PROFILE, type Profile } from "../src/lib/engine/profile";
import type { Benefit } from "../src/lib/engine/profile";
import type { Program, RegionIndex } from "../src/lib/data/types";

const B = path.resolve(__dirname, "../public/bundles/v1");
const load = (f: string): Program[] => (fs.existsSync(path.join(B, f)) ? JSON.parse(fs.readFileSync(path.join(B, f), "utf8")).programs : []);
const regions = JSON.parse(fs.readFileSync(path.join(B, "regions.json"), "utf8")) as RegionIndex;
export const S = ["수원 사는 59년생 부모님 두 분","안산 사는 73살 혼자 살아요","안양 스물여덟 구직 중이에요","고등학교 자퇴한 열일곱살이에요 수원","학교 안 다니는 열여섯살 안산","중학생인데 부모님이 안 계셔요 수원","열여덟살 고삼 딸 엄마예요 수원","고등학생 딸 키우는 엄마 안산","장인어른 모시고 삽니다 부천","초등학생 아들 키우는 아빠 수원","화성 동탄 살아요 실직했어요","사십대 후반 가장이에요 화성","수원 사는 삼십대 중반 프리랜서예요","고양 일산 사는 신혼부부","아이 키우는 엄마 안산","용인 사는 8개월 아기 엄마예요","일흔둘 혼자 사시는 아버지 부천","용인 86년생 자녀 2명 세후 400","남양주 월세 살아요","김포 군 제대했어요 스물셋","시흥 한부모 아이 둘","대학생이에요 수원 스물둘","임신 5개월이에요 성남","수원 사는 서른다섯 실직했어요","부천 육십대 초반 퇴직했어요","의정부 사는 쉰다섯 일자리 찾아요"];

export function top5(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const run = (k: string, sit: Situation) => {
    const p = sit.profile;
    const progs = [...load(`sigungu/${p.sigungu}.json`), ...load(`sido/${p.sido}.json`), ...load("national.json")].map(refineProgram);
    out[k] = topPicksV2(buildView(scoreV2(progs, sit), sit, 12), 5, sit).map((g) => g[0].s.program.name);
  };
  for (const pr of PRESETS) run("preset:" + pr.id, situationOf(pr.profile, pr.x, pr.mode ?? "self"));
  for (const t of S) {
    const r = parseSituation(t, regions, { year: 2026, month: 10, day: 9 });
    const p: Profile = { ...EMPTY_PROFILE };
    for (const [k, v] of Object.entries(r.profile)) if (v !== null && v !== "unknown" && !(Array.isArray(v) && !v.length)) (p as unknown as Record<string, unknown>)[k] = v;
    const benefits: Partial<Record<Benefit, boolean>> = {};
    r.profile.benefits?.forEach((k) => (benefits[k] = true));
    r.benefitsNo?.forEach((k) => (benefits[k] = false));
    const traits: Record<string, boolean> = {};
    r.profile.traits?.forEach((k) => (traits[k] = true));
    const ex = parsedExtras(r);
    run(t, { profile: p, x: { ...EMPTY_EXTRAS, benefits, traits, ...ex, ageSpan: ex.ageSpan ?? null }, mode: r.mode ?? "self" });
  }
  return out;
}

if (require.main === module) {
  const out = process.argv[2];
  if (!out) throw new Error("사용: npx tsx scripts/persona-top5.ts <출력.json>");
  fs.writeFileSync(out, JSON.stringify(top5(), null, 1));
}
