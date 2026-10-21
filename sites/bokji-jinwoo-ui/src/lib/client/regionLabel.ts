/**
 * 시·도 목록에 보여 줄 이름 (QA 8차: '전남광주통합특별시'가 생소하다는 의견).
 * 행정표준코드(pipeline/data/sigungu_codes_20260701.tsv)에서 광주광역시(29000)·전라남도(46000)가 '폐지'되고
 * 전남광주통합특별시(12000)로 합쳐졌다 — 옛 이름을 함께 적어 찾기 쉽게 한다.
 */
const FORMER: Record<string, string> = { "12000": "옛 광주광역시·전라남도" };

export function sidoOptionLabel(s: { code: string; name: string; pilot?: boolean }): string {
  const former = FORMER[s.code];
  return `${s.name}${former ? ` (${former})` : ""}${s.pilot ? " (시범 지역)" : ""}`;
}
