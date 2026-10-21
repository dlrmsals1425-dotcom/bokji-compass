/** 상세 정보 샤드: 결과 목록용 번들은 가볍게, 상세 필드는 id 해시로 나눈 details/{bucket}.json 에 둔다 */
export const DETAIL_BUCKETS = 256;

/** FNV-1a 32bit → 0..DETAIL_BUCKETS-1 (파이프라인·브라우저 공용) */
export function detailBucket(id: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return (h % DETAIL_BUCKETS).toString(16).padStart(2, "0");
}
