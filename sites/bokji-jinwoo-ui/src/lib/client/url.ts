/**
 * 주소 정리 (?example= · ?for= 를 지우거나 남김). 이미 같은 주소면 아무것도 하지 않는다.
 *
 * 왜: Next.js App Router는 history.replaceState를 가로채 라우터 상태와 맞춘다. 클라이언트 이동
 * (router.push)으로 새 화면의 응답·메타데이터가 아직 오는 중에 같은 주소로 replaceState를 부르면,
 * 서버가 바쁠 때 새 화면의 <title>이 끝내 붙지 않는 경우가 있었다 (부모님 예시 → /results?for=parent,
 * 부하 시 40회 중 9회 재현 · axe document-title 간헐 실패의 원인).
 */
export function replaceUrl(path: string) {
  if (typeof window === "undefined") return;
  if (window.location.pathname + window.location.search === path) return;
  window.history.replaceState(null, "", path);
}
