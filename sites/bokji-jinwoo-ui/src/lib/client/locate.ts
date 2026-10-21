/**
 * 현재 위치 → 시·군·구 (전국 확대 ③, 2026-10-10). 위치(좌표)는 기기 밖으로 보내지 않는다:
 * 시·군·구 경계(public/geo, 약 320KB)를 내려받아 브라우저 안에서 점이 어느 경계 안에 있는지 계산한다. 좌표는 저장하지 않는다.
 * 경계 출처: vuski/admdongkor ver20260701 (통계청 SGIS 행정동 경계, CC BY 4.0) — pipeline/src/geo/README.md
 */
export const GEO_URL = "/geo/sgg-20260701.json";

type Ring = [number, number][];
type Geom = { type: "Polygon"; coordinates: Ring[] } | { type: "MultiPolygon"; coordinates: Ring[][] };
export interface SggFeature {
  properties: { c: string };
  geometry: Geom;
}

let cache: Promise<SggFeature[]> | null = null;
export function loadBoundaries(): Promise<SggFeature[]> {
  cache ??= fetch(GEO_URL)
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
    .then((j) => {
      if (!j || typeof j !== "object" || !("features" in j) || !Array.isArray(j.features)) {
        throw new Error("Invalid region boundaries");
      }
      return j.features as SggFeature[];
    })
    .catch((e) => {
      cache = null;
      throw e;
    });
  return cache;
}

function inRing(x: number, y: number, r: Ring): boolean {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i];
    const [xj, yj] = r[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const polys = (g: Geom): Ring[][] => (g.type === "Polygon" ? [g.coordinates] : g.coordinates);
const inPoly = (x: number, y: number, p: Ring[]) => inRing(x, y, p[0]) && !p.slice(1).some((h) => inRing(x, y, h));

/** 점에서 선분까지 거리의 제곱 (경도는 위도에 맞춰 줄인 평면 근사) */
function segDist2(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const t = dx || dy ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy))) : 0;
  return (px - (ax + t * dx)) ** 2 + (py - (ay + t * dy)) ** 2;
}

/** 경계 안에 있으면 그 시·군·구, 아니면(해안·섬 가까이) 약 5km 안의 가장 가까운 경계선의 시·군·구, 그것도 아니면 null (국외 등) */
export function sigunguAt(features: SggFeature[], lat: number, lng: number): string | null {
  for (const f of features) if (polys(f.geometry).some((p) => inPoly(lng, lat, p))) return f.properties.c;
  let best: { c: string; d: number } | null = null;
  const kx = Math.cos((lat * Math.PI) / 180);
  const px = lng * kx;
  for (const f of features)
    for (const p of polys(f.geometry)) {
      const r = p[0];
      for (let i = 1; i < r.length; i++) {
        const d = segDist2(px, lat, r[i - 1][0] * kx, r[i - 1][1], r[i][0] * kx, r[i][1]);
        if (!best || d < best.d) best = { c: f.properties.c, d };
      }
    }
  return best && Math.sqrt(best.d) < 0.045 ? best.c : null;
}

/** 브라우저 위치 (누를 때만 권한을 묻는다) */
export function currentPosition(): Promise<{ lat: number; lng: number }> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return reject(new Error("unsupported"));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      (e) => reject(e),
      { enableHighAccuracy: false, timeout: 15_000, maximumAge: 10 * 60_000 },
    );
  });
}
