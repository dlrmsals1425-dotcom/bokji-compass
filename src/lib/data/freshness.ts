/** 데이터 현황 '확인 지연' (2026-10-22 보완대책 9): 매일 확인이 이만큼 넘게 없으면 멈춘 것으로 본다 (매일 1번 + 늦게 도는 날 여유) */
export const STALE_HOURS = 36;

/** 마지막 확인 뒤 지난 시간(시간 단위) — 기준을 넘었을 때만, 아니면 null */
export function staleHours(checkedAt: string, now: Date = new Date()): number | null {
  const t = Date.parse(checkedAt);
  if (Number.isNaN(t)) return null;
  const h = Math.floor((now.getTime() - t) / 3_600_000);
  return h > STALE_HOURS ? h : null;
}
