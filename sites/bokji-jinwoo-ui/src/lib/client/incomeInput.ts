/**
 * 월 소득(만원) 입력 칸 해석 (QA 8차: '100.5'가 1005로, '-100'이 100으로 바뀌던 문제).
 * 적은 글자를 지우거나 바꾸지 않는다 — 알아볼 수 없으면 값을 쓰지 않고 오류 문구를 보여 준다.
 * 쉼표·띄어쓰기·끝의 '만원'은 허용 (예: '1,200', '250 만원'), 소수는 둘째 자리까지 (예: 250.5).
 */
export interface ManwonInput {
  /** 해석한 값 (빈 칸·오류면 null) */
  value: number | null;
  /** 보여 줄 오류 문구 (없으면 null) */
  error: string | null;
}

export const INCOME_MAX_MANWON = 99999;

export function parseManwonInput(text: string): ManwonInput {
  const t = text.replace(/[,\s]/g, "").replace(/만\s*원?$|원$/, "");
  if (!t) return { value: null, error: null };
  if (/^[-−–]/.test(t)) return { value: null, error: "소득은 0 이상으로 적어 주세요. 소득이 없으면 0을 적어 주세요." };
  if (!/^\d+(?:\.\d{1,2})?$/.test(t)) return { value: null, error: "숫자로 적어 주세요 (만원 단위, 예: 300 또는 250.5)." };
  const v = Number(t);
  if (v > INCOME_MAX_MANWON) return { value: null, error: `${INCOME_MAX_MANWON.toLocaleString("ko-KR")}만원 이하로 적어 주세요 (만원 단위예요).` };
  return { value: v, error: null };
}
