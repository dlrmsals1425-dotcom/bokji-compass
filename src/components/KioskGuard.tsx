"use client";
/**
 * 키오스크 모드 (2026-10-16 회의: 주민센터 12인치 태블릿, 터치만).
 * - 첫 화면은 쉬운 찾기(/easy, 예/아니요로만 — 2026-10-21 소유자). 홈으로 가도 그리로
 * - 손대지 않으면 안내 → 20초 뒤 답을 모두 지우고 처음으로 (다음 분에게 앞사람 답이 보이지 않게)
 * - 화면 아래 '처음으로'(답 지우기) 단추
 * 설정은 /kiosk 에서 (기관 담당자). 답은 원래대로 이 기기 안에서만, 공용 기기 모드라 브라우저를 닫으면 사라짐.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { clearProfile, useSettings } from "@/lib/client/storage";

export const KIOSK_HOME = "/easy";
const WARN_SEC = 20;

export function KioskGuard() {
  const settings = useSettings();
  const kiosk = settings?.kiosk ?? null;
  const path = usePathname();
  const router = useRouter();
  const [left, setLeft] = useState<number | null>(null);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tick = useRef<ReturnType<typeof setInterval> | null>(null);

  const reset = useCallback(() => {
    clearProfile();
    try {
      sessionStorage.clear();
    } catch {}
    // 화면 상태(질문 단계 등)까지 지우려고 새로 불러온다 (router.push는 같은 화면이면 상태가 남음)
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign(KIOSK_HOME);
  }, []);

  const stopWarn = useCallback(() => {
    if (tick.current) clearInterval(tick.current);
    tick.current = null;
    setLeft(null);
  }, []);

  const arm = useCallback(() => {
    if (!kiosk) return;
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => {
      setLeft(WARN_SEC);
      tick.current = setInterval(() => {
        setLeft((v) => (v === null ? null : v - 1));
      }, 1000);
    }, kiosk.idleSec * 1000);
  }, [kiosk]);

  useEffect(() => {
    if (left !== null && left <= 0) reset();
  }, [left, reset]);

  useEffect(() => {
    if (!kiosk || path === "/kiosk") return;
    arm();
    const onAct = () => {
      if (tick.current) return; // 안내 중에는 '계속하기'로만
      arm();
    };
    const evs = ["pointerdown", "keydown", "wheel", "touchstart"] as const;
    evs.forEach((e) => window.addEventListener(e, onAct, { passive: true }));
    return () => {
      evs.forEach((e) => window.removeEventListener(e, onAct));
      if (idleTimer.current) clearTimeout(idleTimer.current);
      if (tick.current) clearInterval(tick.current);
      tick.current = null;
    };
  }, [kiosk, path, arm]);

  useEffect(() => {
    if (kiosk && path === "/") router.replace(KIOSK_HOME);
  }, [kiosk, path, router]);

  if (!kiosk || path === "/kiosk") return null;
  return (
    <>
      <div className="kiosk-bar no-print">
        <button type="button" className="btn btn-ghost" onClick={reset} data-testid="kiosk-reset">
          처음으로 (답 지우기)
        </button>
      </div>
      {left !== null && (
        <div className="kiosk-idle" role="alertdialog" aria-modal="true" aria-labelledby="kiosk-idle-h" data-testid="kiosk-idle">
          <div className="kiosk-idle-box">
            <h2 className="h2" id="kiosk-idle-h">
              계속 쓰고 계신가요?
            </h2>
            <p className="body">{Math.max(0, left)}초 뒤 답을 지우고 처음 화면으로 돌아가요.</p>
            <div className="btn-row">
              <button
                type="button"
                className="btn btn-primary"
                autoFocus
                onClick={() => {
                  stopWarn();
                  arm();
                }}
                data-testid="kiosk-continue"
              >
                계속하기
              </button>
              <button type="button" className="btn btn-ghost" onClick={reset}>
                지금 처음으로
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
