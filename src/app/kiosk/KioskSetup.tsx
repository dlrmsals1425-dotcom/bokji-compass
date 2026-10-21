"use client";
/** 키오스크 설정 (기관 담당자용): 이 기관이 있는 시·군·구, 손대지 않으면 처음으로 돌아갈 시간 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { loadRegions } from "@/lib/client/bundles";
import { sidoOptionLabel } from "@/lib/client/regionLabel";
import { KIOSK_HOME } from "@/components/KioskGuard";
import { setKiosk, useSettings } from "@/lib/client/storage";
import type { RegionIndex } from "@/lib/data/types";

const IDLE = [
  { sec: 60, label: "1분" },
  { sec: 120, label: "2분" },
  { sec: 300, label: "5분" },
];

export function KioskSetup() {
  const router = useRouter();
  const settings = useSettings();
  const on = settings?.kiosk ?? null;
  const [regions, setRegions] = useState<RegionIndex | null>(null);
  const [sido, setSido] = useState("");
  const [sgg, setSgg] = useState("");
  const [idle, setIdle] = useState(120);
  useEffect(() => {
    loadRegions().then(setRegions, () => setRegions(null));
  }, []);
  const sidoObj = regions?.sidos.find((s) => s.code === sido);
  const start = () => {
    const g = sidoObj?.sigungus.find((x) => x.code === sgg);
    if (!sidoObj || !g) return;
    setKiosk({ sido: sidoObj.code, sigungu: g.code, label: `${sidoObj.short ?? sidoObj.name} ${g.name}`, idleSec: idle });
    router.push(KIOSK_HOME);
  };
  return (
    <div className="narrow page">
      <h1 className="h1">키오스크 설정</h1>
      <p className="body">주민센터·복지관 태블릿에서 쓰는 모드예요. 예/아니요로만 답하는 쉬운 찾기로 바로 시작하고, 사는 곳은 아래 지역으로 묻고, 손대지 않으면 답을 지우고 처음으로 돌아가요.</p>
      {on && (
        <div className="notice" data-testid="kiosk-on">
          <p>
            지금 키오스크 모드예요 — <b>{on.label}</b>, {IDLE.find((i) => i.sec === on.idleSec)?.label ?? `${on.idleSec}초`} 뒤 처음으로
          </p>
          <div className="btn-row" style={{ marginTop: "0.75rem" }}>
            <button type="button" className="btn btn-ghost" onClick={() => setKiosk(null)} data-testid="kiosk-stop">
              키오스크 모드 끄기
            </button>
          </div>
        </div>
      )}
      <div className="select-row" style={{ marginTop: "1.5rem" }}>
        <div>
          <label className="hint" htmlFor="k-sido">
            시·도
          </label>
          <select
            id="k-sido"
            className="select"
            value={sido}
            disabled={!regions}
            onChange={(e) => {
              setSido(e.target.value);
              setSgg("");
            }}
            data-testid="kiosk-sido"
          >
            <option value="">시·도 고르기</option>
            {regions?.sidos.map((s) => (
              <option key={s.code} value={s.code}>
                {sidoOptionLabel({ code: s.code, name: s.name })}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="hint" htmlFor="k-sgg">
            시·군·구
          </label>
          <select id="k-sgg" className="select" value={sgg} disabled={!sidoObj} onChange={(e) => setSgg(e.target.value)} data-testid="kiosk-sigungu">
            <option value="">{sidoObj ? "시·군·구 고르기" : "시·도 먼저"}</option>
            {sidoObj?.sigungus.map((g) => (
              <option key={g.code} value={g.code}>
                {g.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <fieldset className="kiosk-idle-pick" style={{ marginTop: "1.25rem", border: 0, padding: 0 }}>
        <legend className="hint">손대지 않으면 처음으로</legend>
        <div className="btn-row">
          {IDLE.map((i) => (
            <button key={i.sec} type="button" className={`btn ${idle === i.sec ? "btn-primary" : "btn-ghost"}`} aria-pressed={idle === i.sec} onClick={() => setIdle(i.sec)}>
              {i.label}
            </button>
          ))}
        </div>
      </fieldset>
      <div className="btn-row" style={{ marginTop: "1.5rem" }}>
        <button type="button" className="btn btn-primary" disabled={!sgg} onClick={start} data-testid="kiosk-start">
          이 지역으로 키오스크 시작
        </button>
      </div>
      <p className="small muted" style={{ marginTop: "1rem" }}>
        키오스크 모드에서는 큰 글씨·공용 기기(브라우저를 닫으면 답이 지워짐)로 바뀌고, 메뉴와 아래 안내는 숨겨요. 끄려면 이 화면(/kiosk)으로 다시 오세요.
      </p>
    </div>
  );
}
