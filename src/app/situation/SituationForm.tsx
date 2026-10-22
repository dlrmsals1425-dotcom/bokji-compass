"use client";
/**
 * '내 상황' 입력 (기본 입력 화면, 한 화면 · 질문 12개 안팎 + 문장 칸). 모든 질문에 '모름'이 있고 사는 곳만 필수.
 * 내 복지: 자녀·임신·한부모·일(구직·학생)·다문화를 묻고, 기초연금·장기요양은 60세 이상이라고 답했을 때만.
 * 부모님 복지: 기초연금·장기요양을 묻고 자녀 질문은 묻지 않는다.
 * 답은 이 기기에만 저장한다 (주소에는 싣지 않음).
 */
import { sidoOptionLabel } from "@/lib/client/regionLabel";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Icon } from "@/components/Icon";
import { VoiceInput } from "@/components/VoiceInput";
import { CrisisHelp } from "@/components/CrisisHelp";
import { RadioGroup } from "@/components/Choice";
import { loadRegions } from "@/lib/client/bundles";
import { clearPrefill, parseSituation, parsedExtras, readPrefill, understoodLine, type ParsedSituation, type Prefill } from "@/lib/client/parse";
import { householdLabel, parseFindMode, resultsPath, type FindMode } from "@/lib/client/mode";
import { readDraft, saveFiller, saveMode, useExtras, useMode, useProfile, useQuickResults, type Draft } from "@/lib/client/storage";
import { saveSituation } from "@/lib/client/start";
import { parseManwonInput } from "@/lib/client/incomeInput";
import { EMPTY_EXTRAS, SUPPORT_LEVELS, extrasFromProfile, incomeExplain, type Extras } from "@/lib/client/v2";
import type { RegionIndex } from "@/lib/data/types";
import { ACTIVITY_LABEL, AGE_BANDS, AGE_LABEL, CHILD_BUCKETS, HOUSING_LABEL, CHILD_LABEL, EMPTY_PROFILE, INCOME_LABEL, ageRange, type AgeBand, type Benefit, type ChildBucket, type Profile } from "@/lib/engine/profile";
import styles from "../finder.module.css";

export function SituationForm() {
  const stored = useProfile();
  const storedMode = useMode();
  const storedX = useExtras();
  const storedQuick = useQuickResults();
  const params = useSearchParams();
  const urlMode = parseFindMode(params.get("for"));
  const fresh = params.get("new") === "1";
  const wantPrefill = params.get("prefill") === "1";
  if (stored === undefined || storedMode === undefined || storedX === undefined || storedQuick === undefined) return <div className="narrow page muted">불러오는 중…</div>;
  const mode0 = urlMode ?? storedMode;
  const d0 = fresh ? null : startingAnswers(mode0, storedMode, stored, storedX);
  return <Form initial={d0?.profile ?? EMPTY_PROFILE} initialX={d0?.x ?? EMPTY_EXTRAS} initialMode={mode0} wantPrefill={wantPrefill} initialQuick={!fresh && !wantPrefill && storedQuick && mode0 === storedMode} />;
}

/**
 * 이 대상(본인/부모님)의 지난 답 (QA 8차: 내 복지 답이 부모님 복지로, 부모님 답이 내 복지로 넘어가던 문제).
 * 대상별로 저장한 답이 있으면 그것, 없으면 지금 저장된 답이 같은 대상의 것일 때만 — 다른 사람의 답은 쓰지 않고 '모름'으로 시작한다.
 */
function startingAnswers(mode: FindMode, storedMode: FindMode, stored: Profile | null, storedX: Extras | null): Draft | null {
  const d = readDraft(mode);
  if (d) return d;
  if (stored && storedMode === mode) return { profile: stored, x: storedX ?? extrasFromProfile(stored) };
  return null;
}

type Tri3 = "yes" | "no" | "unknown";
const triOf = (v: boolean | undefined): Tri3 => (v === undefined ? "unknown" : v ? "yes" : "no");
const boolOf = (v: Tri3): boolean | undefined => (v === "unknown" ? undefined : v === "yes");
const YN = [
  { value: "yes" as const, label: "예" },
  { value: "no" as const, label: "아니요" },
];

const RECIPIENTS: Benefit[] = ["livelihood", "medical", "housing", "education", "near_poverty"];

function supportValue(x: Extras): string {
  const b = x.benefits;
  if (RECIPIENTS.every((k) => b[k] === false)) return "none";
  for (const l of SUPPORT_LEVELS) if (b[l.on[0]] === true) return l.key;
  return "unknown";
}

/** 문장 해석 결과를 입력값에 얹는다 (알아들은 것만, '예'인 것만) */
function mergeParsed(prev: Profile, q: Profile): Profile {
  const next = { ...prev };
  for (const k of Object.keys(q) as (keyof Profile)[]) {
    const v = q[k];
    if (v === null || v === "unknown") continue;
    if (Array.isArray(v) && v.length === 0) continue;
    (next as Record<string, unknown>)[k] = v;
  }
  return next;
}
function mergeParsedX(prev: Extras, ps: ParsedSituation): Extras {
  const q = ps.profile;
  const benefits = { ...prev.benefits };
  q.benefits?.forEach((b) => (benefits[b] = true));
  // '기초연금 안 받아요', '수급자는 아니에요' (QA 1차 C2)
  ps.benefitsNo?.forEach((b) => (benefits[b] = false));
  const traits = { ...prev.traits };
  q.traits?.forEach((t) => (traits[t] = true));
  // 남편·아내를 말했으면 한부모 아님 (QA 8차 후속)
  ps.traitsNo?.forEach((t) => (traits[t] = false));
  // 문장에서 읽은 월 소득·자녀 수 (예: '월급은 세후 400정도' → 400, '자녀 2명' → 2)
  const ex = parsedExtras(ps);
  if (ex.childCount !== undefined && ex.childCount !== 2) traits.multi_child = ex.childCount === 3;
  // 문장에서 읽은 나이 범위·관심 주제·다른 분 나이는 새 문장 기준으로 바꾼다 (지난 문장 것이 남지 않게)
  const next = { ...prev, benefits, traits, ...ex, ageSpan: ex.ageSpan ?? null, interests: ex.interests, otherAge: ex.otherAge ?? null };
  if (ex.childCount != null || q.children?.length) delete next.family;
  return next;
}

/** 문장을 다시 읽을 때, 문장에 없어 그대로 남는 지난 답 (사람이 알 수 있게 보여 준다 — QA 8차) */
function keptAnswers(p: Profile, x: Extras, r: ParsedSituation): string[] {
  const q = r.profile;
  const out: string[] = [];
  if (p.age !== "unknown" && q.age === "unknown") out.push(`나이 ${AGE_LABEL[p.age as AgeBand]}`);
  if (p.householdSize !== "unknown" && q.householdSize === "unknown") out.push(`가구원 ${p.householdSize}명`);
  if (x.incomeManwon !== null && !r.income) out.push(`소득 월 ${x.incomeManwon.toLocaleString("ko-KR")}만원`);
  if (p.activity !== "unknown" && q.activity === "unknown") out.push(`하는 일 '${ACTIVITY_LABEL[p.activity]}'`);
  if (p.housing !== "unknown" && q.housing === "unknown") out.push(`집 '${HOUSING_LABEL[p.housing]}'`);
  return out;
}

/** 확인 화면의 '알아들은 내용' — 지역·나이·상황 한 줄, 같이 사는 사람(가정이면 바로 바꾸는 단추), 소득 */
function UnderstoodLines({ ps, alt, onAlt, suffix }: { ps: ParsedSituation; alt: boolean; onAlt: (alt: boolean) => void; suffix?: string }) {
  const main = understoodLine(ps, ["household", "income"]);
  const hh = ps.understood.find((u) => u.key === "household")?.label;
  const inc = ps.understood.find((u) => u.key === "income")?.label;
  const a = ps.householdAlt;
  return (
    <>
      {(main || suffix) && (
        <p className="pf-l">
          <strong>{main || "지역·나이는 알아듣지 못했어요"}</strong>
          {suffix}
        </p>
      )}
      {/* 가구 단추 글자는 누르면 바뀔 값 (지금 값은 앞의 굵은 글씨) — 2026-10-22 상태/동작 혼동 점검 */}
      {hh && (
        <p className="pf-l" data-testid="prefill-household">
          <strong>{a && alt ? a.label : hh}</strong>
          {a && (
            <button type="button" className="btn btn-ghost btn-sm pf-alt" onClick={() => onAlt(!alt)} data-testid="prefill-hh-alt">
              {alt ? `배우자 포함 ${a.mainSize}명으로 되돌리기` : `${a.button}으로 바꾸기`}
            </button>
          )}
        </p>
      )}
      {inc && (
        <p className="pf-l" data-testid="prefill-income">
          <strong>{inc}</strong>
        </p>
      )}
    </>
  );
}

/**
 * 확인 화면에서 바로 채우기 (QA 1차 H2·H4): 지역을 못 읽었거나 두 곳으로 읽히면 여기서 고르고,
 * 나이·가구원 수를 모르면 단추 하나로 고른다 (긴 입력 화면 맨 위로 돌아가지 않아도 됨)
 */
function QuickFill({ ps, p, mode, regions, setP }: { ps: ParsedSituation; p: Profile; mode: FindMode; regions: RegionIndex | null; setP: (f: (prev: Profile) => Profile) => void }) {
  const parent = mode === "parent";
  const sido = regions?.sidos.find((s) => s.code === p.sido);
  const ages: AgeBand[] = ps.ageChoices?.length ? ps.ageChoices : parent ? ["60-64", "65-69", "70-74", "75-79", "80+"] : ["19-24", "25-29", "30-34", "35-39", "40-49", "50-59", "60-64", "65-69", "70-74", "75-79", "80+"];
  // 해석 결과 기준으로 보여 준다 (고른 뒤에도 단추가 남아 있어 바꿀 수 있게)
  const needRegion = !ps.profile.sigungu;
  const needAge = ps.profile.age === "unknown";
  const needHh = ps.profile.householdSize === "unknown";
  if (!needRegion && !needAge && !needHh) return null;
  return (
    <div className="pf-quick" data-testid="prefill-quick">
      {needRegion && (
        <div className="pf-q" data-testid="prefill-region">
          <p className="pf-qh">{parent ? "부모님이 사시는 곳" : "사는 곳"} <span className="req">(필수)</span></p>
          {ps.regionChoices && (
            <div className="pf-chips" role="group" aria-label="지역 고르기">
              {ps.regionChoices.map((c) => (
                <button key={c.label} type="button" className={`btn btn-sm ${p.sido === c.sido && p.sigungu === c.sigungu ? "btn-primary" : "btn-ghost"}`} aria-pressed={p.sido === c.sido && p.sigungu === c.sigungu} onClick={() => setP((prev) => ({ ...prev, sido: c.sido, sigungu: c.sigungu }))} data-testid="prefill-region-choice">
                  {c.label}
                </button>
              ))}
            </div>
          )}
          <div className="select-row">
            <div>
              <label htmlFor="pf-sido" className="label small">시·도</label>
              <select id="pf-sido" className="select" value={p.sido ?? ""} onChange={(e) => setP((prev) => ({ ...prev, sido: e.target.value || null, sigungu: null }))}>
                <option value="">선택하세요</option>
                {regions?.sidos.map((s) => (
                  <option key={s.code} value={s.code}>{sidoOptionLabel({ code: s.code, name: s.name })}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="pf-sigungu" className="label small">시·군·구</label>
              <select id="pf-sigungu" className="select" value={p.sigungu ?? ""} disabled={!sido} onChange={(e) => setP((prev) => ({ ...prev, sigungu: e.target.value || null }))} data-testid="prefill-sigungu">
                <option value="">{sido ? "선택하세요" : "시·도를 먼저 고르세요"}</option>
                {sido?.sigungus.map((g) => (
                  <option key={g.code} value={g.code}>{g.name}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
      )}
      {needAge && (
        <div className="pf-q" data-testid="prefill-age">
          <p className="pf-qh">{parent ? "부모님 나이" : "나이"} <span className="small muted">(만 나이 · 모르면 넘어가도 돼요)</span></p>
          <div className="pf-chips" role="group" aria-label="나이대 고르기">
            {ages.map((a) => (
              <button key={a} type="button" className={`btn btn-sm ${p.age === a ? "btn-primary" : "btn-ghost"}`} aria-pressed={p.age === a} onClick={() => setP((prev) => ({ ...prev, age: a }))}>
                {AGE_LABEL[a]}
              </button>
            ))}
          </div>
        </div>
      )}
      {needHh && (
        <div className="pf-q" data-testid="prefill-hh">
          <p className="pf-qh">함께 사는 가족 <span className="small muted">({parent ? "부모님 포함" : "본인 포함"} · 소득 기준을 정할 때 써요)</span></p>
          <div className="pf-chips" role="group" aria-label="가구원 수 고르기">
            {([1, 2, 3, 4, 5, 6] as const).filter((n) => n >= (ps.minHousehold ?? 1)).map((n) => (
              <button key={n} type="button" className={`btn btn-sm ${p.householdSize === n ? "btn-primary" : "btn-ghost"}`} aria-pressed={p.householdSize === n} onClick={() => setP((prev) => ({ ...prev, householdSize: n }))}>
                {householdLabel(mode, n)}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const CHILD_AGES = CHILD_BUCKETS.filter((c) => c !== "pregnant");

function Form({ initial, initialX, initialMode, wantPrefill, initialQuick }: { initial: Profile; initialX: Extras; initialMode: FindMode; wantPrefill: boolean; initialQuick: boolean }) {
  const router = useRouter();
  // 홈 검색창 문장 해석 (sessionStorage로만 전달). Form은 저장소를 읽은 뒤(클라이언트)에만 그려진다.
  const [prefill, setPrefill] = useState<Prefill | null>(() => (wantPrefill ? readPrefill() : null));
  const [mode, setMode] = useState<FindMode>(() => prefill?.parsed.mode ?? initialMode);
  const [p, setP] = useState<Profile>(() => (prefill ? mergeParsed(EMPTY_PROFILE, prefill.parsed.profile) : initial));
  const [x, setX] = useState<Extras>(() => (prefill ? mergeParsedX(EMPTY_EXTRAS, prefill.parsed) : initialX));
  const [text, setText] = useState("");
  const [voiceRevision, setVoiceRevision] = useState(0);
  const textRef = useRef<HTMLTextAreaElement>(null);
  // 보훈·다문화를 이미 답했으면(문장·저장된 답) '더 답하기'를 펼친 채로 (결정 5b)
  const [moreOpen, setMoreOpen] = useState(() => x.traits.veteran !== undefined || x.traits.multicultural !== undefined);
  const [understood, setUnderstood] = useState<ParsedSituation | null>(null);
  /** 이 화면에서 대상을 바꿀 때 두고 온 답 · 가져올 수 있는 다른 대상의 답 (QA 8차) */
  const [drafts, setDrafts] = useState<Partial<Record<FindMode, Draft>>>({});
  const [carry, setCarry] = useState<{ from: FindMode; draft: Draft } | null>(null);
  /** 문장에 없어 그대로 둔 지난 답 (QA 8차) */
  const [kept, setKept] = useState<string[]>([]);
  const [regions, setRegions] = useState<RegionIndex | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [incomeText, setIncomeText] = useState(() => {
    const v = prefill?.parsed.income?.manwon ?? initialX.incomeManwon;
    return v !== null && v !== undefined ? String(v) : "";
  });
  // 가구원 수를 '배우자 포함'으로 가정했을 때, 한 번에 '배우자 없이'로 바꿨는지
  const [hhAlt, setHhAlt] = useState(false);

  useEffect(() => {
    loadRegions().then(setRegions);
  }, []);

  const parent = mode === "parent";
  const who = parent ? "부모님" : "";
  const set = <K extends keyof Profile>(k: K, v: Profile[K]) => setP((prev) => ({ ...prev, [k]: v }));
  const setB = (patch: Partial<Record<Benefit, boolean | undefined>>) =>
    setX((prev) => {
      const b = { ...prev.benefits };
      for (const [k, v] of Object.entries(patch) as [Benefit, boolean | undefined][]) {
        if (v === undefined) delete b[k];
        else b[k] = v;
      }
      return { ...prev, benefits: b };
    });
  const setTrait = (k: keyof Extras["traits"], v: boolean | undefined) =>
    setX((prev) => {
      const t = { ...prev.traits };
      if (v === undefined) delete t[k];
      else t[k] = v;
      return { ...prev, traits: t };
    });

  /**
   * 대상 바꾸기 (QA 8차): 지금 적은 답은 이 화면 안에 두고, 바꾼 대상의 지난 답(없으면 모두 '모름')으로 시작한다.
   * 다른 대상의 답이 필요하면 '가져오기' 단추로 직접 고른다. 돌아오면 적던 답이 그대로 있다.
   */
  const switchMode = (next: FindMode): Draft => {
    if (next === mode) return { profile: p, x };
    const here = { profile: p, x };
    const there = drafts[next] ?? readDraft(next) ?? { profile: EMPTY_PROFILE, x: EMPTY_EXTRAS };
    setDrafts((d) => ({ ...d, [mode]: here }));
    setCarry({ from: mode, draft: here });
    setP(there.profile);
    setX(there.x);
    setIncomeText(there.x.incomeManwon !== null ? String(there.x.incomeManwon) : "");
    setMode(next);
    setUnderstood(null);
    setKept([]);
    setHhAlt(false);
    return there;
  };
  const carryOver = (all: boolean) => {
    if (!carry) return;
    if (all) {
      setP(carry.draft.profile);
      setX(carry.draft.x);
      setIncomeText(carry.draft.x.incomeManwon !== null ? String(carry.draft.x.incomeManwon) : "");
    } else setP((prev) => ({ ...prev, sido: carry.draft.profile.sido, sigungu: carry.draft.profile.sigungu }));
    setCarry(null);
  };
  const applyParsed = (r: ParsedSituation, base?: Draft) => {
    const b0 = base ?? { profile: p, x };
    setP(mergeParsed(b0.profile, r.profile));
    setX(mergeParsedX(b0.x, r));
    if (r.income) setIncomeText(String(r.income.manwon));
    setHhAlt(false);
  };
  const fillFromText = async () => {
    setVoiceRevision((revision) => revision + 1);
    // 지역 목록을 아직 못 받았으면 기다렸다가 읽는다 (빨리 누르면 지역을 놓치던 문제)
    const rg = regions ?? (await loadRegions().catch(() => null));
    const r = parseSituation(text, rg, undefined, { hint: mode });
    // 문장이 다른 대상(예: 부모님 이야기)이면 그 대상의 답에서 시작한다 — 지금 대상의 답을 섞지 않음
    const base = r.mode && r.mode !== mode ? switchMode(r.mode) : { profile: p, x };
    setKept(keptAnswers(base.profile, base.x, r));
    applyParsed(r, base);
    setUnderstood(r);
  };
  /** 같이 사는 사람: 배우자 포함(가정) ↔ 배우자 없이(한부모) */
  const chooseHh = (ps: ParsedSituation, alt: boolean) => {
    const a = ps.householdAlt;
    if (!a) return;
    setHhAlt(alt);
    set("householdSize", alt ? a.size : (a.mainSize as Profile["householdSize"]));
    setTrait("single_parent", alt && a.singleParent ? true : undefined);
    // '배우자 없이'를 고르면 배우자 없음, 되돌리면 모름 (배우자 포함은 가정이었으므로)
    setX((prev) => ({ ...prev, spouse: alt ? false : undefined }));
  };

  const sido = regions?.sidos.find((s) => s.code === p.sido);
  const size = p.householdSize === "unknown" ? null : p.householdSize;
  const income = x.incomeManwon;
  const incomeError = parseManwonInput(incomeText).error;
  const explain = income !== null && size ? incomeExplain(income, size) : null;
  const ageKnown = p.age !== "unknown";
  const senior60 = ageKnown && ageRange(p.age as Exclude<Profile["age"], "unknown">)[1] >= 60;
  // 기초연금·장기요양: 부모님은 60세 미만이라고 답하지 않았으면, 본인은 60세 이상이라고 답했을 때만
  const askSenior = parent ? !ageKnown || senior60 : senior60;
  // 자녀·임신·한부모·다문화: 본인 찾기에서 60세 이상이 아닐 때
  const askFamily = !parent && !senior60;
  // 돌봄: 부모님·어르신·장애가 있을 때 (그 밖에는 결과 화면에서 필요할 때만 물어봐요)
  const askCare = parent || senior60 || p.disability === "self" || p.disability === "member" || p.care !== null;

  const childCount = x.childCount ?? null;
  const ages = p.children ?? [];
  const setChildren = (count: 0 | 1 | 2 | 3 | null, list: ChildBucket[]) => {
    const keep = count === 0 ? list.filter((c) => c === "pregnant") : list;
    setP((prev) => ({ ...prev, children: keep.length ? keep : count === 0 ? [] : null }));
    setX((prev) => {
      const t = { ...prev.traits };
      if (count === null || count === 2) delete t.multi_child;
      else t.multi_child = count === 3;
      const next: Extras = { ...prev, traits: t };
      delete next.family;
      if (count === null) delete next.childCount;
      else next.childCount = count;
      return next;
    });
  };
  const toggleAge = (c: ChildBucket) => setChildren(childCount, ages.includes(c) ? ages.filter((a) => a !== c) : [...ages, c]);

  const go = () => {
    saveMode(mode);
    if (parent) saveFiller("child");
    clearPrefill();
    saveSituation({ profile: p, x, mode }, mode, undefined, initialQuick && mode === initialMode);
    router.push(resultsPath(mode));
  };
  const submit = () => {
    if (incomeError) {
      setError(null);
      document.getElementById("income")?.scrollIntoView({ block: "center" });
      document.getElementById("income")?.focus();
      return;
    }
    if (!p.sigungu) {
      setError(parent ? "부모님이 사시는 시·군·구를 골라 주세요." : "사는 시·군·구를 골라 주세요.");
      document.getElementById("sit-region")?.scrollIntoView({ block: "center" });
      document.getElementById(p.sido ? "sigungu" : "sido")?.focus();
      return;
    }
    go();
  };
  const editPrefill = () => {
    clearPrefill();
    setPrefill(null);
    requestAnimationFrame(() => document.getElementById("sit-basic-h")?.scrollIntoView({ block: "start" }));
  };

  const disabilityValue =
    p.disability === "none" ? "none" : p.disability === "unknown" ? "unknown" : `${p.disability}-${p.disabilitySeverity === "mild" ? "mild" : "severe"}`;

  return (
    <div className={`${styles.finder} ${styles.talk}`}>
      <div className="form-head">
        <div className="narrow">
          <div className={styles.routeRow}>
          <ol className="crumbs" aria-label="현재 위치">
            <li>
              <Link href="/">
                <Icon name="home" size={14} /> 홈
              </Link>
            </li>
            <li>
              <span aria-current="page">말로 찾기</span>
            </li>
          </ol>
          </div>
          <h1 className="h1" style={{ marginBottom: "0.25rem" }}>
            {parent ? "부모님 상황" : "내 상황"}
          </h1>
          <div className="mode-switch" role="group" aria-label="찾기 대상">
            <button type="button" className={!parent ? "on" : ""} aria-pressed={!parent} onClick={() => switchMode("self")} data-testid="mode-self">
              내 복지
            </button>
            <button type="button" className={parent ? "on" : ""} aria-pressed={parent} onClick={() => switchMode("parent")} data-testid="mode-parent">
              부모님 복지
            </button>
          </div>
          {carry && carry.draft.profile.sigungu && (
            <p className="small carry-row" data-testid="mode-carry">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => carryOver(false)} data-testid="carry-region">
                {carry.from === "parent" ? "부모님" : "내"} 사는 곳만 가져오기
              </button>{" "}
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => carryOver(true)} data-testid="carry-all">
                {carry.from === "parent" ? "부모님" : "내"} 답 모두 가져오기
              </button>
            </p>
          )}
        </div>
      </div>
      <div className="form-body">
        <div className="narrow">
          <div className="form-panel v2-form" data-testid="v2-situation" data-mode={mode}>
            {prefill && (
              <section className="prefill-box" data-testid="prefill-banner" aria-labelledby="pf-h">
                <h2 id="pf-h" className="pf-title">
                  <Icon name="check" size={20} strokeWidth={2.6} /> 이렇게 이해했어요
                </h2>
                <p className="pf-quote">&ldquo;{prefill.text}&rdquo;</p>
                <CrisisHelp text={prefill.text} />
                <div className="pf-line" data-testid="prefill-line">
                  {understoodLine(prefill.parsed) ? (
                    <UnderstoodLines ps={prefill.parsed} alt={hhAlt} onAlt={(v) => chooseHh(prefill.parsed, v)} suffix={parent ? " · 부모님 대신 찾기" : undefined} />
                  ) : (
                    <p className="pf-l">
                      <strong>알아들은 내용이 거의 없어요</strong>
                      {parent ? " · 부모님 대신 찾기" : ""}
                    </p>
                  )}
                </div>
                {prefill.parsed.notes.length > 0 && (
                  <ul className="pf-notes">
                    {prefill.parsed.notes.map((n) => (
                      <li key={n}>{n}</li>
                    ))}
                  </ul>
                )}
                <QuickFill ps={prefill.parsed} p={p} mode={mode} regions={regions} setP={setP} />
                {!p.sigungu && <p className="small muted">사는 시·군·구를 선택하세요.</p>}
                <div className="pf-actions">
                  <button type="button" className="btn btn-primary" onClick={go} disabled={!p.sigungu} data-testid="prefill-confirm">
                    맞아요, 결과 보기 <Icon name="arrowRight" size={18} />
                  </button>
                  <button type="button" className="btn btn-ghost" onClick={editPrefill} data-testid="prefill-edit">
                    아래에서 더 답하기
                  </button>
                </div>
              </section>
            )}
            {!prefill && (
              <section aria-labelledby="sit-free-h" className="v2-block">
                <h2 className="sr-only" id="sit-free-h">음성 또는 글로 상황 입력</h2>
                <VoiceInput contextKey={`${mode}:${voiceRevision}`} value={text} onApply={(nextText) => { setText(nextText); textRef.current?.focus(); }} />
                <label htmlFor="sit-text" className="hint">
                  상황 입력
                </label>
                <textarea id="sit-text" className="input" rows={3} placeholder={parent ? "예: 수원에 사시는 75세 어머니, 혼자 살고 계세요." : "예: 고양시에 사는 29살, 혼자 살고 일자리를 찾고 있어요."} ref={textRef} value={text} onChange={(e) => setText(e.target.value)} data-testid="v2-text" />
                <div className="btn-row" style={{ marginTop: "0.5rem" }}>
                  <button type="button" className="btn btn-tonal btn-sm" onClick={fillFromText} disabled={!text.trim()} data-testid="v2-fill">
                    입력 내용 반영
                  </button>
                </div>
                {understood && (
                  <div className="notice" role="status" style={{ marginTop: "0.75rem" }} data-testid="v2-understood">
                    <Icon name="check" size={18} />
                    <div className="pf-line">
                      <p className="pf-l">
                        <strong>이렇게 이해했어요</strong>
                      </p>
                      {understoodLine(understood) ? (
                        <UnderstoodLines ps={understood} alt={hhAlt} onAlt={(v) => chooseHh(understood, v)} />
                      ) : (
                        <p className="pf-l">알아들은 내용이 없어요. 아래 질문에 직접 답해 주세요.</p>
                      )}
                      {understood.notes.length > 0 && (
                        <ul className="pf-notes" data-testid="v2-understood-notes">
                          {understood.notes.map((n) => (
                            <li key={n}>{n}</li>
                          ))}
                        </ul>
                      )}
                      {kept.length > 0 && (
                        <p className="pf-l small" data-testid="v2-understood-kept">
                          이전 답변 유지: {kept.join(", ")}. 달라졌다면 수정하세요.
                        </p>
                      )}
                      <QuickFill ps={understood} p={p} mode={mode} regions={regions} setP={setP} />
                    </div>
                  </div>
                )}
              </section>
            )}

            <section aria-labelledby="sit-basic-h" className="v2-block" id="sit-region">
              <h2 className="h3" id="sit-basic-h">
                1. 기본
              </h2>
              {error && (
                <p role="alert" className="error">
                  <Icon name="alert" size={18} /> {error}
                </p>
              )}
              <div className="select-row field">
                <div>
                  <label htmlFor="sido" className="label">
                    {who ? `${who}이 사는 ` : "사는 "}시·도 <span className="req">(필수)</span>
                  </label>
                  <select id="sido" className="select" value={p.sido ?? ""} onChange={(e) => setP((prev) => ({ ...prev, sido: e.target.value || null, sigungu: null }))}>
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
                    시·군·구 <span className="req">(필수)</span>
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
              <div className="select-row field">
                <div>
                  <label htmlFor="age" className="label">
                    {parent ? "부모님 나이 (만)" : "나이 (만)"}
                  </label>
                  <select id="age" className="select" value={p.age} onChange={(e) => set("age", e.target.value as Profile["age"])}>
                    <option value="unknown">건너뛰기</option>
                    {(p.age !== "unknown" && !(AGE_BANDS as readonly string[]).includes(p.age) ? [...AGE_BANDS, p.age] : AGE_BANDS).map((a) => (
                      <option key={a} value={a}>
                        {AGE_LABEL[a]}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="hh" className="label">
                    함께 사는 가족 (본인 포함)
                  </label>
                  <select
                    id="hh"
                    className="select"
                    value={String(p.householdSize)}
                    onChange={(e) => set("householdSize", e.target.value === "unknown" ? "unknown" : (Number(e.target.value) as 1 | 2 | 3 | 4 | 5 | 6))}
                  >
                    <option value="unknown">건너뛰기</option>
                    {[1, 2, 3, 4, 5, 6].map((n) => (
                      <option key={n} value={n}>
                        {householdLabel(mode, n)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              {askSenior && p.householdSize !== "unknown" && p.householdSize >= 2 && (
                <RadioGroup
                  name="spouse"
                  legend={parent ? "부모님이 배우자분과 함께 사시나요?" : "배우자와 함께 사세요?"}
                  hint="기초연금은 본인과 배우자의 소득·재산만 봐요. 함께 사는 자녀 소득은 빼고 생각해요."
                  options={YN}
                  value={triOf(x.spouse)}
                  unknownLabel="건너뛰기"
                  onChange={(v) => setX((prev) => ({ ...prev, spouse: boolOf(v) }))}
                />
              )}
            </section>

            <section aria-labelledby="sit-money-h" className="v2-block">
              <h2 className="h3" id="sit-money-h">
                2. 지금 받는 지원과 소득
              </h2>
              <RadioGroup
                name="support"
                legend={parent ? "부모님이 주민센터에서 받고 있는 지원이 있나요?" : "주민센터에서 받고 있는 지원이 있나요?"}
                hint="가장 높은 단계 하나만 고르세요 (생계급여를 받으면 의료·주거급여도 함께 받는 경우가 많아요)."
                options={[
                  { value: "none", label: "없어요 (받지 않아요)" },
                  ...SUPPORT_LEVELS.map((l) => ({ value: l.key, label: `${l.label} (${l.plain})` })),
                ]}
                value={supportValue(x)}
                unknownLabel="건너뛰기"
                onChange={(v) => {
                  if (v === "unknown") return setB(Object.fromEntries(RECIPIENTS.map((k) => [k, undefined])));
                  const lv = SUPPORT_LEVELS.find((l) => l.key === v);
                  setB(Object.fromEntries(RECIPIENTS.map((k) => [k, lv ? lv.on.includes(k) : false])));
                }}
              />
              {askSenior && (
                <RadioGroup
                  name="basic-pension"
                  legend={parent ? "부모님이 기초연금을 받고 계신가요?" : "기초연금을 받고 계신가요?"}
                  hint="만 65세 이상 중 소득·재산이 적은 70%가 받는 연금이에요 (국민연금과 달라요)."
                  options={YN}
                  value={triOf(x.benefits.basic_pension)}
                  unknownLabel="건너뛰기"
                  onChange={(v) => setB({ basic_pension: boolOf(v) })}
                />
              )}
              <fieldset className="field">
                <legend>{parent ? "부모님 가구의 한 달 소득은 얼마쯤인가요?" : "가구 전체의 한 달 소득은 얼마쯤인가요?"}</legend>
                <p className="hint" id="inc-h">
                  일해서 버는 돈·연금·임대료 등을 모두 더해 대략 적어 주세요. 함께 사는 가족 수 기준으로 계산해요.
                </p>
                <div className="v2-income">
                  <label htmlFor="income" className="sr-only">
                    한 달 소득 (만원)
                  </label>
                  <input
                    id="income"
                    className="input"
                    inputMode="decimal"
                    maxLength={12}
                    aria-describedby={incomeError ? "inc-h inc-err" : "inc-h inc-band"}
                    aria-invalid={incomeError ? true : undefined}
                    value={incomeText}
                    placeholder="예: 300"
                    onChange={(e) => {
                      // 적은 글자를 지우거나 바꾸지 않는다 (QA 8차: '100.5' → 1005, '-100' → 100 이던 문제)
                      const t = e.target.value;
                      setIncomeText(t);
                      const r = parseManwonInput(t);
                      setX((prev) => ({ ...prev, incomeManwon: r.value }));
                      // (2026-10-23 외부 의견) 저장할 때 금액을 소득 구간으로도 남기므로, 칸을 지우거나 고치면 그 구간도 지운다 — 지운 소득이 판정에 남지 않게
                      set("income", "unknown");
                    }}
                    data-testid="v2-income"
                  />
                  <span>만원 / 월</span>
                  <label className="opt unknown v2-inline">
                    <input
                      type="checkbox"
                      checked={income === null && !incomeText.trim() && p.income === "unknown"}
                      onChange={() => {
                        setIncomeText("");
                        setX((prev) => ({ ...prev, incomeManwon: null }));
                        set("income", "unknown");
                      }}
                    />
                    <span>건너뛰기</span>
                  </label>
                </div>
                {incomeError && (
                  <p className="error" id="inc-err" role="alert" data-testid="v2-income-error">
                    {incomeError}
                  </p>
                )}
                <p className="small" id="inc-band" aria-live="polite" data-testid="v2-income-band">
                  {explain
                    ? explain.line
                    : income !== null && !size
                      ? "함께 사는 가족 수를 고르면 기준을 계산해 드려요."
                      : income === null && p.income !== "unknown"
                        ? `지난번에 고른 소득(기준 중위소득 ${INCOME_LABEL[p.income]})으로 찾고 있어요. 바꾸려면 금액을 적거나 건너뛰기를 누르세요.`
                        : ""}
                </p>
                <p className="small muted">재산(집·예금)도 소득으로 환산해 함께 보는 혜택이 많아요. 정확한 계산(소득인정액)은 신청할 때 주민센터에서 해 줘요.</p>
              </fieldset>
            </section>

            {askFamily && (
              <section aria-labelledby="sit-family-h" className="v2-block" data-testid="sit-family">
                <h2 className="h3" id="sit-family-h">
                  3. 자녀·임신
                </h2>
                <RadioGroup
                  name="child-count"
                  legend="함께 사는(키우는) 자녀는 몇 명인가요?"
                  hint="다자녀 혜택은 보통 2명 또는 3명 이상부터예요."
                  options={[
                    { value: "0", label: "없어요" },
                    { value: "1", label: "1명" },
                    { value: "2", label: "2명" },
                    { value: "3", label: "3명 이상" },
                  ]}
                  value={childCount === null ? "unknown" : String(childCount)}
                  unknownLabel="건너뛰기"
                  onChange={(v) => setChildren(v === "unknown" ? null : (Number(v) as 0 | 1 | 2 | 3), ages)}
                />
                <fieldset className="field" data-testid="child-ages">
                  <legend>
                    {childCount === 0 ? "임신 중이신가요?" : "자녀 나이 · 임신"} <span className="small muted">(해당하는 것 모두)</span>
                  </legend>
                  <div className="opts">
                    {(childCount === 0 ? (["pregnant"] as ChildBucket[]) : (["pregnant", ...CHILD_AGES] as ChildBucket[])).map((c) => (
                      <label className="opt" key={c}>
                        <input type="checkbox" name="child-age" checked={ages.includes(c)} onChange={() => toggleAge(c)} />
                        <span>{c === "pregnant" ? "임신 중 (출산 예정)" : CHILD_LABEL[c]}</span>
                      </label>
                    ))}
                    <p className="or" aria-hidden="true">
                      또는
                    </p>
                    <label className="opt unknown">
                      <input type="checkbox" name="child-age" checked={ages.length === 0} onChange={() => setChildren(childCount, [])} />
                      <span>{childCount === 0 ? "아니요 / 건너뛰기" : "건너뛰기"}</span>
                    </label>
                  </div>
                </fieldset>
                {childCount !== 0 && (
                  <RadioGroup
                    name="single-parent"
                    legend="혼자 자녀를 키우는 한부모 가구인가요?"
                    hint="이혼·사별·미혼 등으로 혼자 자녀를 키우는 경우예요 (조부모가 손주를 키우는 조손 가구 포함)."
                    options={YN}
                    value={triOf(x.traits.single_parent)}
                    unknownLabel="건너뛰기"
                    onChange={(v) => setTrait("single_parent", boolOf(v))}
                  />
                )}
              </section>
            )}

            <section aria-labelledby="sit-health-h" className="v2-block">
              <h2 className="h3" id="sit-health-h">
                {askFamily ? "4" : "3"}. 건강·돌봄
              </h2>
              <RadioGroup
                name="disability"
                legend={parent ? "부모님 중 장애인으로 등록된 분이 있나요?" : "나 또는 함께 사는 가족이 장애인으로 등록되어 있나요?"}
                options={
                  parent
                    ? [
                        { value: "none", label: "아니요" },
                        { value: "self-severe", label: "예 — 심한 장애" },
                        { value: "self-mild", label: "예 — 심하지 않은 장애" },
                      ]
                    : [
                        { value: "none", label: "아니요" },
                        { value: "self-severe", label: "본인 — 심한 장애" },
                        { value: "self-mild", label: "본인 — 심하지 않은 장애" },
                        { value: "member-severe", label: "가족 중 — 심한 장애" },
                        { value: "member-mild", label: "가족 중 — 심하지 않은 장애" },
                      ]
                }
                value={parent && disabilityValue.startsWith("member") ? disabilityValue.replace("member", "self") : disabilityValue}
                unknownLabel="건너뛰기"
                onChange={(v) => {
                  if (v === "unknown" || v === "none") return setP((prev) => ({ ...prev, disability: v, disabilitySeverity: "unknown" }));
                  const [d, s] = v.split("-") as ["self" | "member", "severe" | "mild"];
                  setP((prev) => ({ ...prev, disability: d, disabilitySeverity: s }));
                }}
              />
              {askCare && (
                <RadioGroup
                  name="care"
                  legend={parent ? "식사·거동·외출에 다른 사람의 도움이 필요하신가요?" : "식사·거동·외출에 다른 사람의 도움이 필요한가요? (본인 또는 돌보는 가족)"}
                  options={YN}
                  value={p.care === null ? "unknown" : p.care.includes("daily") ? "yes" : "no"}
                  unknownLabel="건너뛰기"
                  onChange={(v) => set("care", v === "unknown" ? null : v === "yes" ? ["daily"] : [])}
                />
              )}
              {askSenior && (
                <RadioGroup
                  name="ltc"
                  legend={parent ? "부모님이 건강보험공단에서 장기요양등급(1~5등급·인지지원등급)을 받으셨나요?" : "건강보험공단에서 장기요양등급(1~5등급·인지지원등급)을 받으셨나요?"}
                  hint="등급이 없으면 ‘아니요’를 선택하세요."
                  options={YN}
                  value={triOf(x.facts.ltcGrade)}
                  unknownLabel="건너뛰기"
                  onChange={(v) => setX((prev) => ({ ...prev, facts: { ...prev.facts, ltcGrade: boolOf(v) } }))}
                />
              )}
            </section>

            <section aria-labelledby="sit-life-h" className="v2-block">
              <h2 className="h3" id="sit-life-h">
                {askFamily ? "5" : "4"}. 일·생활
              </h2>
              <RadioGroup
                name="activity"
                legend={parent ? "부모님이 지금 일을 하고 계신가요?" : "지금 하고 있는 일은요?"}
                options={
                  parent
                    ? [
                        { value: "employed", label: "예, 일해요" },
                        { value: "job_seeking", label: "일자리를 찾고 있어요" },
                        { value: "none", label: "아니요" },
                      ]
                    : [
                        { value: "employed", label: "직장에 다녀요" },
                        { value: "self_employed", label: "자영업·프리랜서" },
                        { value: "job_seeking", label: "일자리를 찾고 있어요" },
                        { value: "student", label: "학생" },
                        { value: "none", label: "일하지 않아요" },
                      ]
                }
                value={parent && p.activity === "self_employed" ? "employed" : parent && p.activity === "student" ? "none" : p.activity}
                unknownLabel="건너뛰기"
                onChange={(v) => set("activity", v as Profile["activity"])}
              />
              <RadioGroup
                name="housing"
                legend={parent ? "부모님 댁은 어떤 형태인가요?" : "사는 집은 어떤 형태인가요?"}
                options={[
                  { value: "own", label: "자가" },
                  { value: "jeonse", label: "전세" },
                  { value: "monthly", label: "월세" },
                  { value: "public_rental", label: "공공임대" },
                ]}
                value={p.housing === "other" ? "unknown" : p.housing}
                unknownLabel="건너뛰기"
                onChange={(v) => set("housing", v)}
              />
              {/* 드문 신분(보훈·다문화)은 접어 둠 — 입력 화면이 길다는 지적 (결정 5b). 이미 답했으면 펼친 채로 */}
              <details className="details sf-more" open={moreOpen} onToggle={(e) => setMoreOpen((e.currentTarget as HTMLDetailsElement).open)} data-testid="sf-more">
                <summary>
                  더 답하기 <span className="small muted">(보훈·다문화 — 해당하는 분만)</span> <Icon name="chevronDown" size={18} />
                </summary>
                <div className="details-body">
                <RadioGroup
                  name="veteran"
                  legend={parent ? "부모님이 국가유공자·참전유공자 등 보훈 대상이신가요?" : "국가유공자 등 보훈 대상(또는 그 가족)인가요?"}
                  options={YN}
                  value={triOf(x.traits.veteran)}
                  unknownLabel="건너뛰기"
                  onChange={(v) => setTrait("veteran", boolOf(v))}
                />
                {askFamily && (
                  <RadioGroup
                    name="multicultural"
                    legend="다문화 가족(결혼이민)이거나 북한이탈주민인가요?"
                    options={YN}
                    value={triOf(x.traits.multicultural)}
                    unknownLabel="건너뛰기"
                    onChange={(v) => setTrait("multicultural", boolOf(v))}
                  />
                )}
                </div>
              </details>
            </section>

            <div className="btn-row" style={{ marginTop: "1.5rem" }}>
              <button type="button" className="btn btn-primary btn-lg" onClick={submit} data-testid="v2-submit">
                {parent ? "부모님께 맞는 혜택 보기" : "나에게 맞는 혜택 보기"} <Icon name="arrowRight" size={18} />
              </button>
              <span className="small muted">건너뛴 질문은 결과에서 다시 답할 수 있어요.</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
