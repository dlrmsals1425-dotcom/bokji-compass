/**
 * 이미 받고 있는 혜택 (2026-10-16 소유자: 보육료처럼 이미 받는 것은 다시 신청할 필요가 없음).
 * 결과 화면에서 '이미 받고 있어요'로 표시한 묶음(같은 사업의 지역 변형 포함)은 먼저 확인할 5가지·목록·준비물 한 장에서 빼고 따로 모은다.
 * 판정은 바꾸지 않고 보여 주는 곳만 바꾼다. 표시는 이 기기에만 저장(주소에 싣지 않음).
 */
import type { V2Item, V2View } from "./v2";

export function splitReceiving(view: V2View, keys: readonly string[]): { view: V2View; receiving: V2Item[][] } {
  if (!keys.length) return { view, receiving: [] };
  const on = new Set(keys);
  const receiving: V2Item[][] = [];
  const keep = (gs: V2Item[][]) =>
    gs.filter((g) => {
      if (!on.has(g[0].s.group)) return true;
      receiving.push(g);
      return false;
    });
  const next: V2View = { ...view, fit: keep(view.fit), ask: keep(view.ask), office: keep(view.office), no: keep(view.no), closed: view.closed ? keep(view.closed) : view.closed };
  // 숨긴 혜택은 추가 질문의 안내 수에서도 제외한다. 관련 혜택이 없으면 질문도 뺀다.
  next.questions = view.questions.flatMap((q) => {
    const keys = q.keys.filter((key) => !on.has(key));
    return keys.length ? [{ ...q, keys, groups: keys.length }] : [];
  });
  next.unlock = new Set(next.questions.flatMap((q) => q.keys)).size;
  return { view: next, receiving };
}
