import {
  ACTIVITY_LABEL, AGE_LABEL, BENEFIT_LABEL, CAR_LABEL, CARE_LABEL, CHILD_LABEL, DISABILITY_LABEL,
  HOUSING_LABEL, INCOME_LABEL, SEVERITY_LABEL, TRAIT_LABEL, type Profile,
} from "../engine/profile";

/** 결과 화면 상단 '내 상황' 칩 (입력한 항목만) */
export function profileChips(p: Profile, regionLabel?: string): string[] {
  const out: string[] = [];
  if (regionLabel) out.push(regionLabel);
  if (p.age !== "unknown") out.push(AGE_LABEL[p.age]);
  if (p.householdSize !== "unknown") out.push(p.householdSize === 6 ? "가구원 6명 이상" : `가구원 ${p.householdSize}명`);
  if (p.traits?.length) out.push(...p.traits.map((t) => TRAIT_LABEL[t]));
  if (p.children) out.push(p.children.length ? `자녀 ${p.children.map((c) => CHILD_LABEL[c]).join("·")}` : "자녀 없음");
  if (p.income !== "unknown") out.push(`중위소득 ${INCOME_LABEL[p.income]}`);
  if (p.benefits?.length) out.push(...p.benefits.map((b) => BENEFIT_LABEL[b]));
  if (p.housing !== "unknown") out.push(HOUSING_LABEL[p.housing]);
  if (p.car !== "unknown") out.push(`차량 ${CAR_LABEL[p.car]}`);
  if (p.activity !== "unknown" && p.activity !== "none") out.push(ACTIVITY_LABEL[p.activity]);
  if (p.care?.length) out.push(...p.care.map((c) => CARE_LABEL[c]));
  if (p.disability === "self" || p.disability === "member")
    out.push(`장애: ${DISABILITY_LABEL[p.disability]}${p.disabilitySeverity !== "unknown" ? `(${SEVERITY_LABEL[p.disabilitySeverity]})` : ""}`);
  return [...new Set(out)];
}
