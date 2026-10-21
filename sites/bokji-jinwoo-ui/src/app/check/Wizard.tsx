"use client";
import { sidoOptionLabel } from "@/lib/client/regionLabel";
import { replaceUrl } from "@/lib/client/url";
import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "@/components/SiteLink";
import { Icon } from "@/components/Icon";
import { MultiGroup, RadioGroup, opts } from "@/components/Choice";
import { clearProfile, saveFiller, saveMode, saveProfile, setSettings, useFiller, useMode, useProfile, useSettings } from "@/lib/client/storage";
import { loadRegions } from "@/lib/client/bundles";
import type { RegionIndex } from "@/lib/data/types";
import { clearPrefill, readPrefill, understoodLine, type Prefill } from "@/lib/client/parse";
import { FILLER_LABEL, householdLabel, parseFindMode, resultsPath, withV1, wizardCopy, type FindMode, type FillerRole } from "@/lib/client/mode";
import {
  ACTIVITIES, ACTIVITY_LABEL, AGE_BANDS, AGE_LABEL, BENEFITS, BENEFIT_LABEL, CARE_LABEL, CARE_NEEDS, CARS, CAR_LABEL,
  CHILD_BUCKETS, CHILD_LABEL, DISABILITY, DISABILITY_SEVERITY, EMPTY_PROFILE, HOUSEHOLD_TRAITS, HOUSING,
  HOUSING_LABEL, INCOME_BANDS, INCOME_LABEL, MEDIAN_INCOME_2026, MEDIAN_INCOME_2027, SEVERITY_LABEL, TRAIT_LABEL, answeredCount, type Profile,
} from "@/lib/engine/profile";

export function Wizard() {
  const stored = useProfile();
  const storedMode = useMode();
  const storedFiller = useFiller();
  // 주소의 ?for= · ?prefill=1 (클라이언트 이동 직후 window.location은 아직 이전 주소일 수 있어 useSearchParams로 읽는다)
  const params = useSearchParams();
  const urlMode = parseFindMode(params.get("for"));
  const wantPrefill = params.get("prefill") === "1";
  if (stored === undefined || storedMode === undefined || storedFiller === undefined) {
    return <div className="narrow page muted">불러오는 중…</div>;
  }
  return (
    <WizardInner
      initial={stored ?? EMPTY_PROFILE}
      editing={!!stored}
      initialMode={storedMode}
      initialFiller={storedFiller}
      urlMode={urlMode}
      wantPrefill={wantPrefill}
    />
  );
}

function WizardInner({
  initial,
  editing,
  initialMode,
  initialFiller,
  urlMode,
  wantPrefill,
}: {
  initial: Profile;
  editing: boolean;
  initialMode: FindMode;
  initialFiller: FillerRole;
  urlMode: FindMode | null;
  wantPrefill: boolean;
}) {
  const router = useRouter();
  const settings = useSettings();
  // 홈 검색창의 상황 문장 해석 (sessionStorage로만 전달, URL에는 prefill=1 표시만).
  // WizardInner는 저장소를 읽은 뒤(클라이언트)에만 그려지므로 초기값에서 바로 읽어도 된다.
  const [prefill, setPrefill] = useState<Prefill | null>(() => (wantPrefill ? readPrefill() : null));
  const [p, setP] = useState<Profile>(() => prefill?.parsed.profile ?? initial);
  const [step, setStep] = useState(0);
  const [regions, setRegions] = useState<RegionIndex | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setModeState] = useState<FindMode>(() => urlMode ?? initialMode);
  const [filler, setFillerState] = useState<FillerRole>(() => (urlMode === "parent" ? "child" : initialFiller));
  const titleRef = useRef<HTMLHeadingElement>(null);
  const copy = wizardCopy(mode);

  useEffect(() => {
    loadRegions().then(setRegions);
  }, []);

  // URL ?for=parent|self → 저장·주소 정리 (마운트 시 1회). editing 의존 금지:
  // finish()에서 saveProfile → editing true 로 effect가 다시 돌면 replaceState가
  // router.push('/results?for=parent')를 덮어 /check에 머물게 된다.
  useEffect(() => {
    const m = urlMode;
    if (m) {
      saveMode(m);
      if (m === "parent") saveFiller("child");
      const url = m === "parent" ? "/check?for=parent" : "/check";
      replaceUrl(withV1(url));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only URL bootstrap
  }, []);

  const set = <K extends keyof Profile>(k: K, v: Profile[K]) => setP((prev) => ({ ...prev, [k]: v }));

  const applyMode = (next: FindMode) => {
    setModeState(next);
    saveMode(next);
    if (next === "parent") {
      setFillerState("child");
      saveFiller("child");
    }
    const url = next === "parent" ? "/check?for=parent" : "/check";
    replaceUrl(withV1(url));
  };

  const go = (next: number) => {
    if (step === 0 && next > 0 && !p.sigungu) {
      setError(
        mode === "parent"
          ? "결과를 보려면 부모님이 사시는 시군구를 선택해 주세요. 지역마다 받을 수 있는 서비스가 달라요."
          : "결과를 보려면 사는 시군구를 선택해 주세요. 지역마다 받을 수 있는 서비스가 달라요.",
      );
      return;
    }
    setError(null);
    setStep(next);
    requestAnimationFrame(() => {
      window.scrollTo({ top: 0 });
      titleRef.current?.focus();
    });
  };

  const finish = () => {
    if (!p.sigungu) {
      setStep(0);
      setError(mode === "parent" ? "부모님이 사시는 시군구를 선택해 주세요." : "사는 시군구를 선택해 주세요.");
      return;
    }
    saveMode(mode);
    if (mode === "parent") saveFiller(filler);
    saveProfile(p, undefined, mode);
    router.push(withV1(resultsPath(mode)));
  };

  /** 해석한 그대로 결과 보기 */
  const confirmPrefill = () => {
    if (!p.sigungu) return;
    clearPrefill();
    saveMode(mode);
    if (mode === "parent") saveFiller(filler);
    saveProfile(p, undefined, mode);
    router.push(withV1(resultsPath(mode)));
  };
  /** 해석 결과를 채운 채로 단계별 입력 */
  const editPrefill = () => {
    clearPrefill();
    setPrefill(null);
    requestAnimationFrame(() => titleRef.current?.focus());
  };

  const sido = regions?.sidos.find((s) => s.code === p.sido);
  const disabilityOpts = DISABILITY.map((v) => ({ value: v, label: copy.disabilityLabels[v] }));

  return (
    <>
      <div className="form-head">
        <div className="narrow">
          <ol className="crumbs" aria-label="현재 위치">
            <li>
              <Link href="/">
                <Icon name="home" size={14} /> 홈
              </Link>
            </li>
            <li>
              <span aria-current="page">{copy.crumb}</span>
            </li>
          </ol>
          <h1 className="h1" style={{ marginBottom: "0.25rem" }}>
            {copy.pageTitle}
          </h1>
          <p className="small muted">
            {copy.progressHint} {answeredCount(p)}개 입력 · 모르는 항목은 &lsquo;모름&rsquo;으로 넘어가도 됩니다
          </p>
          <div className="mode-switch" role="group" aria-label="찾기 대상">
            <button type="button" className={mode === "self" ? "on" : ""} aria-pressed={mode === "self"} onClick={() => applyMode("self")} data-testid="mode-self">
              내 복지
            </button>
            <button type="button" className={mode === "parent" ? "on" : ""} aria-pressed={mode === "parent"} onClick={() => applyMode("parent")} data-testid="mode-parent">
              부모님 복지
            </button>
          </div>
          <ol className="stepper" aria-label={`입력 단계 (${copy.steps.length}단계 중 ${step + 1}단계)`}>
            {copy.steps.map((s, i) => (
              <li key={s} className={i < step ? "done" : i === step ? "now" : ""} aria-current={i === step ? "step" : undefined}>
                <span className="dot" aria-hidden="true">
                  {i < step ? <Icon name="check" size={16} strokeWidth={3} /> : i + 1}
                </span>
                <span className="lbl">{s}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
      <div className="form-body">
        <div className="narrow">
          <div className="form-panel">
            {prefill && (
              <section className="prefill-box" data-testid="prefill-banner" aria-labelledby="pf-h">
                <h2 id="pf-h" className="pf-title">
                  <Icon name="check" size={20} strokeWidth={2.6} /> 이렇게 이해했어요
                </h2>
                <p className="pf-quote">&ldquo;{prefill.text}&rdquo;</p>
                <p className="pf-line" data-testid="prefill-line">
                  <strong>{understoodLine(prefill.parsed) || "알아들은 내용이 거의 없어요"}</strong>
                  {mode === "parent" ? " · 부모님 대신 찾기" : ""}
                </p>
                {prefill.parsed.notes.length > 0 && (
                  <ul className="pf-notes">
                    {prefill.parsed.notes.map((n) => (
                      <li key={n}>{n}</li>
                    ))}
                  </ul>
                )}
                <p className="small muted">
                  {p.sigungu
                    ? "맞으면 결과 보기를 누르세요. 나머지 항목은 '모름'으로 두고 찾고, 결과 화면에서 언제든 고칠 수 있어요."
                    : "시·군·구를 알 수 없어 바로 결과를 볼 수 없어요. 고쳐서 입력해 주세요."}
                  {" "}문장은 이 기기에서만 해석하며 어디에도 보내지 않아요.
                </p>
                <div className="pf-actions">
                  <button type="button" className="btn btn-primary" onClick={confirmPrefill} disabled={!p.sigungu} data-testid="prefill-confirm">
                    맞아요, 결과 보기 <Icon name="arrowRight" size={18} />
                  </button>
                  <button type="button" className="btn btn-ghost" onClick={editPrefill} data-testid="prefill-edit">
                    고쳐서 입력
                  </button>
                </div>
              </section>
            )}
            {copy.banner && (
              <p className="notice warm" data-testid="parent-banner" role="note">
                <Icon name="heart" size={18} />
                <span>{copy.banner}</span>
              </p>
            )}
            <p className="eyebrow">
              {step + 1}단계 · {copy.steps[step]}
            </p>
            <h2 className="h2" tabIndex={-1} ref={titleRef}>
              {copy.questions[step]}
            </h2>

      {step === 0 && (
        <>
          <p className="body">{copy.regionBody}</p>
          {mode === "parent" && (
            <RadioGroup
              name="filler"
              legend="작성하시는 분 (안내 문구용)"
              hint="매칭에는 쓰이지 않아요. 결과 안내 말투만 바꿉니다."
              options={(Object.keys(FILLER_LABEL) as FillerRole[]).map((v) => ({ value: v, label: FILLER_LABEL[v] }))}
              value={filler}
              onChange={(v) => {
                if (v === "unknown") return;
                setFillerState(v);
                saveFiller(v);
              }}
              showUnknown={false}
            />
          )}
          {error && (
            <p role="alert" className="error">
              <Icon name="alert" size={18} /> {error}
            </p>
          )}
          <div className="select-row field">
            <div>
              <label htmlFor="sido" className="label">
                시·도
              </label>
              <select
                id="sido"
                className="select"
                value={p.sido ?? ""}
                onChange={(e) => setP((prev) => ({ ...prev, sido: e.target.value || null, sigungu: null }))}
              >
                <option value="">선택하세요</option>
                {regions?.sidos.map((s) => (
                  <option key={s.code} value={s.code}>
                    {sidoOptionLabel(s)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="sigungu" className="label">
                시·군·구
              </label>
              <select id="sigungu" className="select" value={p.sigungu ?? ""} disabled={!sido} onChange={(e) => set("sigungu", e.target.value || null)}>
                <option value="">{sido ? "선택하세요" : "시·도를 먼저 고르세요"}</option>
                {sido?.sigungus.map((g) => (
                  <option key={g.code} value={g.code}>
                    {g.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {sido && (
            <p className="notice" style={{ marginTop: "1.25rem" }}>
              <Icon name="info" size={18} />
              {sido.pilot
                ? "경기도는 시범 지역이에요. 자격 규칙을 우선 검수하고 있어 더 정확한 결과를 보여드려요."
                : "이 지역은 아직 규칙 검수 전이라 대부분 '가능성 있음'·'확인 필요'로 안내돼요. 서비스 목록과 신청처는 모두 볼 수 있어요."}
            </p>
          )}
        </>
      )}

      {step === 1 && (
        <>
          <RadioGroup name="age" legend={copy.ageLegend} options={opts(AGE_BANDS, AGE_LABEL)} value={p.age} onChange={(v) => set("age", v)} />
          <RadioGroup
            name="hh"
            legend={copy.hhLegend}
            options={[1, 2, 3, 4, 5, 6].map((v) => ({ value: v as 1 | 2 | 3 | 4 | 5 | 6, label: householdLabel(mode, v) }))}
            value={p.householdSize}
            onChange={(v) => set("householdSize", v)}
          />
          <MultiGroup
            name="traits"
            legend={copy.traitsLegend}
            options={opts(HOUSEHOLD_TRAITS, TRAIT_LABEL)}
            value={p.traits}
            onChange={(v) => set("traits", v)}
          />
        </>
      )}

      {step === 2 && (
        <MultiGroup
          name="children"
          legend={copy.childrenLegend}
          hint={copy.childrenHint}
          options={opts(CHILD_BUCKETS, CHILD_LABEL)}
          value={p.children}
          onChange={(v) => set("children", v)}
          noneLabel={copy.childrenNone}
        />
      )}

      {step === 3 && (
        <>
          <RadioGroup
            name="income"
            legend={copy.incomeLegend}
            hint={copy.incomeHint}
            options={opts(INCOME_BANDS, INCOME_LABEL)}
            value={p.income}
            onChange={(v) => set("income", v)}
          />
          <details className="details" style={{ marginTop: "0.75rem" }}>
            <summary>
              기준 중위소득이 뭔가요? <Icon name="chevronDown" size={18} />
            </summary>
            <p className="details-body small">
              2026년 기준 중위소득(월)은 1인 가구 {MEDIAN_INCOME_2026[1]!.toLocaleString("ko-KR")}원, 4인 가구{" "}
              {MEDIAN_INCOME_2026[4]!.toLocaleString("ko-KR")}원이고, 2027년 1월 1일부터는 1인 {MEDIAN_INCOME_2027[1]!.toLocaleString("ko-KR")}원, 4인{" "}
              {MEDIAN_INCOME_2027[4]!.toLocaleString("ko-KR")}원입니다(보건복지부 고시). 다른 가구원 수의 금액과 소득인정액 계산은 복지로
              &lsquo;모의계산&rsquo;에서 확인하세요.
            </p>
          </details>
          <MultiGroup
            name="benefits"
            legend={copy.benefitsLegend}
            options={opts(BENEFITS, BENEFIT_LABEL)}
            value={p.benefits}
            onChange={(v) => set("benefits", v)}
          />
          <RadioGroup name="housing" legend={copy.housingLegend} options={opts(HOUSING, HOUSING_LABEL)} value={p.housing} onChange={(v) => set("housing", v)} />
          <RadioGroup name="car" legend={copy.carLegend} options={opts(CARS, CAR_LABEL)} value={p.car} onChange={(v) => set("car", v)} />
        </>
      )}

      {step === 4 && (
        <>
          <RadioGroup
            name="activity"
            legend={copy.activityLegend}
            options={opts(ACTIVITIES, ACTIVITY_LABEL)}
            value={p.activity}
            onChange={(v) => set("activity", v)}
          />
          <div className="sensitive">
            <p>
              <Icon name="shieldCheck" size={18} /> 선택 입력 · 돌봄·장애 같은 민감 정보는 이 기기에만 저장돼요
            </p>
            <MultiGroup
              name="care"
              legend={copy.careLegend}
              options={opts(CARE_NEEDS, CARE_LABEL)}
              value={p.care}
              onChange={(v) => set("care", v)}
            />
            <RadioGroup
              name="disability"
              legend={copy.disabilityLegend}
              options={disabilityOpts}
              value={p.disability}
              onChange={(v) => setP((prev) => ({ ...prev, disability: v, disabilitySeverity: v === "self" || v === "member" ? prev.disabilitySeverity : "unknown" }))}
              unknownLabel="응답 안 함"
            />
            {(p.disability === "self" || p.disability === "member") && (
              <RadioGroup
                name="severity"
                legend={copy.severityLegend}
                options={opts(DISABILITY_SEVERITY, SEVERITY_LABEL)}
                value={p.disabilitySeverity}
                onChange={(v) => set("disabilitySeverity", v)}
              />
            )}
          </div>
        </>
      )}

      <div className="wizard-nav">
        {step > 0 ? (
          <button type="button" className="btn btn-ghost" onClick={() => go(step - 1)}>
            <Icon name="arrowLeft" size={18} /> 이전
          </button>
        ) : (
          <Link href="/" className="btn btn-ghost">
            취소
          </Link>
        )}
        <div className="grow">
          {step > 0 && step < copy.steps.length - 1 && (
            <button type="button" className="btn btn-text" onClick={finish}>
              {copy.finishEarly}
            </button>
          )}
          {step < copy.steps.length - 1 ? (
            <button type="button" className="btn btn-primary" onClick={() => go(step + 1)} data-testid="next">
              다음 <Icon name="arrowRight" size={18} />
            </button>
          ) : (
            <button type="button" className="btn btn-primary" onClick={finish} data-testid="finish">
              {copy.finish} <Icon name="arrowRight" size={18} />
            </button>
          )}
        </div>
      </div>
          </div>

          <div className="wizard-aside">
            <span style={{ display: "inline-flex", gap: "0.375rem", alignItems: "center" }}>
              <Icon name="shieldCheck" size={18} /> 입력한 내용은 서버로 보내지 않고 이 브라우저에만 저장됩니다.
            </span>
            <label className="check-inline">
              <input type="checkbox" checked={settings?.shared ?? false} onChange={(e) => setSettings({ shared: e.target.checked })} />
              공용 기기 모드 (브라우저를 닫으면 삭제)
            </label>
            {editing && (
              <button
                type="button"
                className="btn btn-text"
                onClick={() => {
                  clearProfile();
                  setP(EMPTY_PROFILE);
                  setModeState("self");
                  setFillerState("child");
                  setStep(0);
                }}
              >
                이 기기에서 지우기
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
