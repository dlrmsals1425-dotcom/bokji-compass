"use client";
/**
 * 화면에서 신청서를 작성하고, 작성한 내용이 들어간 한글 파일을 내려받는 화면.
 *
 * 적은 내용은 이 화면의 메모리에만 있다. 서버·저장소·주소창에 남기지 않고,
 * 화면을 떠나면 값과 내려받기 주소를 지운다. 원본 서식만 공개 주소에서 받아 온다.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { loadProgramForms } from "@/lib/client/forms";
import { formAssetUrl } from "@/lib/data/formPublication";
import { fetchTemplateBytes, buildFilledHwpx, fieldError, registrationField } from "@/lib/client/hwpxWriter";
import { activeEntries, budgetLabel, entryEnabled, exclusiveSiblings, normalizeInput, slotBudget, type WriteCheck, type WriteField, type WriteGroup, type WritingTemplate } from "@/lib/data/formWriting";
import { writingDisclosure } from "@/lib/data/formWritingDisclosures";
import styles from "./FormWriter.module.css";

type Gate =
  | { state: "loading" }
  | { state: "blocked"; reason: string }
  | { state: "ready"; programName: string; use: "main" | "additional" | "conditional"; condition?: string; checkedAt: string };

const USE_LABEL = { main: "신청서", conditional: "해당하는 경우 내는 서식", additional: "함께 확인할 서류" } as const;

const NO_PROGRAM: Gate = {
  state: "blocked",
  reason: "어떤 복지 서비스의 신청서인지 확인할 수 없어요. 서비스 상세 화면에서 '화면에서 작성하기'를 눌러 주세요.",
};

/** 공개된 사업–서식 연결과 원본 파일 정보가 등록부와 똑같을 때만 작성을 연다. */
function useGate(template: WritingTemplate, programId: string | undefined): Gate {
  const [gate, setGate] = useState<Gate>({ state: "loading" });
  useEffect(() => {
    if (!programId) return;
    let alive = true;
    loadProgramForms(programId).then(data => {
      if (!alive) return;
      if (!data) {
        setGate({ state: "blocked", reason: "서식 연결 정보를 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요." });
        return;
      }
      const link = data.entry.links.find(item => item.formId === template.formId);
      const form = data.forms.find(item => item.id === template.formId);
      if (!link || !form) {
        setGate({ state: "blocked", reason: "이 서비스에 연결된 신청서가 아니에요. 서비스 상세 화면에서 안내된 서식을 확인해 주세요." });
        return;
      }
      const file = form.file;
      if (!file || file.format !== "hwpx" || file.bytes !== template.asset.bytes || file.sha256 !== template.asset.sha256
        || formAssetUrl(file.hwp) !== template.asset.path) {
        setGate({ state: "blocked", reason: "공개된 원본 서식이 화면 작성에 등록해 둔 원본과 달라요. 원본 받기로 내려받아 직접 작성해 주세요." });
        return;
      }
      setGate({ state: "ready", programName: data.entry.name, use: link.use, condition: link.condition, checkedAt: link.checkedAt });
    });
    return () => { alive = false; };
  }, [template, programId]);
  return programId ? gate : NO_PROGRAM;
}

function groupFields(group: WriteGroup): WriteField[] {
  return [...(group.fields ?? []), ...(group.rows ?? []).flatMap(row => row.fields.map(field => ({ ...field, label: `${row.label} · ${field.label}` }))), ...(group.groups ?? []).flatMap(groupFields)];
}
function groupChecks(group: WriteGroup): WriteCheck[] {
  return [...(group.lead ? [group.lead] : []), ...(group.checks ?? []), ...(group.groups ?? []).flatMap(groupChecks)];
}

export function FormWriter({ template, programId }: { template: WritingTemplate; programId?: string }) {
  const gate = useGate(template, programId);
  const [values, setValues] = useState<Record<string, string>>({});
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const [rowsShown, setRowsShown] = useState<Record<string, number>>({});
  const [stepIndex, setStepIndex] = useState(0);
  const [failure, setFailure] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const urlRef = useRef<string | null>(null);

  // 고른 묶음 안의 입력만 검사하고, 마지막 확인과 내려받기에도 그 값만 쓴다.
  const active = useMemo(() => activeEntries(template, checks), [template, checks]);
  const normalized = useMemo(() => normalizeInput(template, values, checks), [template, values, checks]);
  const errors = useMemo(() => {
    const out: Record<string, string> = {};
    for (const field of active.fields) {
      const problem = fieldError(template, field, values[field.key] ?? "");
      if (problem) out[field.key] = problem;
    }
    return out;
  }, [template, active, values]);

  // 화면을 떠나면 적은 값과 내려받기 주소를 지운다.
  useEffect(() => () => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
  }, []);

  useEffect(() => { headingRef.current?.focus(); }, [stepIndex]);

  if (gate.state !== "ready") {
    return (
      <main className={`wrap ${styles.page}`}>
        <Link className={styles.back} href={programId ? `/p/${encodeURIComponent(programId)}` : "/forms"}>← 돌아가기</Link>
        <h1 className={styles.title}>{template.title}</h1>
        <p role="status">{gate.state === "loading" ? "서식 정보를 확인하고 있어요." : gate.reason}</p>
      </main>
    );
  }

  const steps = template.steps;
  const exclusive = exclusiveSiblings(template);
  const reviewing = stepIndex >= steps.length;
  const step = steps[Math.min(stepIndex, steps.length - 1)];
  const blockingErrors = [...Object.values(errors), ...normalized.conflicts];

  const setValue = (key: string, value: string) => { setSaved(false); setValues(current => ({ ...current, [key]: value })); };
  // 원본이 하나만 고르게 한 자리는, 새로 고른 것만 남긴다.
  const setCheck = (key: string, value: boolean) => {
    setSaved(false);
    const next = { ...checks, [key]: value };
    if (value) for (const sibling of exclusive.get(key) ?? []) next[sibling] = false;
    const enabled = normalizeInput(template, values, next);
    setChecks(enabled.checks);
    setValues(enabled.values);
  };

  async function download() {
    setFailure(null);
    setBusy(true);
    try {
      const bytes = await fetchTemplateBytes(template);
      const filled = await buildFilledHwpx(template, bytes, { values, checks });
      const blob = new Blob([filled.bytes as unknown as BlobPart], { type: "application/hwp+zip" });
      const url = URL.createObjectURL(blob);
      urlRef.current = url;
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filled.fileName;
      anchor.click();
      // 내려받기가 시작되면 메모리의 주소는 바로 되돌린다.
      setTimeout(() => { URL.revokeObjectURL(url); if (urlRef.current === url) urlRef.current = null; }, 4000);
      setSaved(true);
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "파일을 만들지 못했어요.");
    } finally {
      setBusy(false);
    }
  }

  const renderField = (field: WriteField) => !entryEnabled(template.formId, field.key, checks) ? null : (
    <div className={styles.field} key={field.key}>
      <label htmlFor={`f-${field.key}`}>
        {field.label}
        <span className={styles.hint}>{field.hint ? `${field.hint} · ` : ""}{registrationField(field) ? "숫자 13자리(- 포함 14자)" : field.input === "tel" ? "숫자와 - 로 전화번호를 적어 주세요." : budgetLabel(slotBudget(template.formId, field.slot))}</span>
      </label>
      <input
        id={`f-${field.key}`}
        type={field.input === "email" ? "email" : field.input === "tel" ? "tel" : "text"}
        inputMode={registrationField(field) || /\.(year|month|day)$/.test(field.key) ? "numeric" : field.input === "tel" ? "tel" : undefined}
        value={values[field.key] ?? ""}
        onChange={event => setValue(field.key, event.target.value)}
        aria-invalid={errors[field.key] ? true : undefined}
        aria-describedby={errors[field.key] ? `e-${field.key}` : undefined}
        autoComplete="off"
      />
      {errors[field.key] && <p className={styles.error} id={`e-${field.key}`}>{errors[field.key]} <a href={template.asset.path} download>빈 원본 서식 받기</a></p>}
    </div>
  );

  const renderCheck = (item: WriteCheck, lead = false) => !entryEnabled(template.formId, item.key, checks) ? null : (
    <li key={item.key}>
      <label className={`${styles.check} ${lead ? styles.lead : ""}`}>
        <input type="checkbox" data-testid={`writer-check-${item.key}`} checked={!!checks[item.key]} onChange={event => setCheck(item.key, event.target.checked)} />
        <span>{item.label}</span>
      </label>
    </li>
  );

  const renderGroup = (group: WriteGroup, depth = 0) => {
    if (group.whenAny && !group.whenAny.some(key => checks[key])) return null;
    const open = !group.lead || !!checks[group.lead.key];
    const shown = rowsShown[group.id] ?? 1;
    const disclosure = writingDisclosure(template.formId, group.id);
    return (
      <section className={`${styles.group} ${depth ? styles.nested : ""}`} key={group.id}>
        {group.title.replace(/\s/g, "") !== step.title.replace(/\s/g, "") && <h3 className={styles.groupTitle}>{group.title}</h3>}
        {group.note && <p className={styles.groupNote}>{group.note}</p>}
        {!!disclosure.length && <details className={styles.disclosure}>
          <summary>동의·확인하기 전에 원문 전체 읽기</summary>
          {disclosure.map((paragraph, index) => <p key={index}>{paragraph}</p>)}
        </details>}
        {group.lead && <ul className={styles.checks}>{renderCheck(group.lead, true)}</ul>}
        {open && <>
          {!!group.fields?.length && <div className={styles.fields}>{group.fields.map(renderField)}</div>}
          {!!group.checks?.length && <ul className={styles.checks}>{group.checks.map(item => renderCheck(item))}</ul>}
          {!!group.rows?.length && <>
            {group.rows.slice(0, shown).map(row => (
              <div className={styles.row} key={row.label}>
                <p className={styles.rowTitle}>{row.label}</p>
                <div className={styles.fields}>{row.fields.map(renderField)}</div>
              </div>
            ))}
            {shown < group.rows.length && (
              <button type="button" className={`btn btn-ghost ${styles.more}`}
                onClick={() => setRowsShown(current => ({ ...current, [group.id]: shown + 1 }))}>
                {group.rows[shown].label} 적기 +
              </button>
            )}
          </>}
          {group.groups?.map(nested => renderGroup(nested, depth + 1))}
        </>}
      </section>
    );
  };

  // 마지막 확인에는 문서에 실제로 들어갈 값만 보여 준다(접은 묶음 안의 값은 빠진다).
  const liveFields = new Set(active.fields.map(field => field.key));
  const liveChecks = new Set(active.checks.map(item => item.key));
  const filledSummary = steps.map(current => {
    const entries: { label: string; value: string }[] = [];
    for (const group of current.groups) {
      for (const field of groupFields(group)) {
        const value = normalized.values[field.key];
        if (value && liveFields.has(field.key)) entries.push({ label: field.label, value });
      }
      for (const item of groupChecks(group)) {
        if (normalized.checks[item.key] && liveChecks.has(item.key)) entries.push({ label: "선택함", value: item.label });
      }
    }
    return { title: current.title, entries };
  });

  return (
    <main className={`wrap ${styles.page}`}>
      <Link className={styles.back} href={`/p/${encodeURIComponent(programId!)}`}>← {gate.programName} 상세로 돌아가기</Link>
      <h1 className={styles.title}>{template.title}</h1>
      <p className={styles.basis}>{gate.programName} · {USE_LABEL[gate.use]} · {template.lawTitle} · {`연결 확인일 ${gate.checkedAt}`}</p>
      {gate.condition && <p className={styles.basis}>{gate.condition}</p>}
      <div className={styles.notice}>
        <p>적은 내용은 이 기기 안에서만 처리하고 외부로 보내지 않아요. 화면을 닫으면 사라지니 작성한 파일을 먼저 내려받아 주세요.</p>
        <p>해당되지 않는 칸은 비워 두어도 돼요. 다 쓰면 한글 파일로 받아 인쇄한 뒤 <strong>직접 서명하거나 도장을 찍어</strong> 접수기관에 내야 해요.</p>
        <p>부모님 신청서를 작성할 때는 부모님 정보와 대리인 정보를 각 항목에 맞게 구분해 적어 주세요. 이 화면에서 신청이 접수되지는 않아요.</p>
      </div>

      <ol className={styles.progress}>
        {steps.map((current, index) => (
          <li key={current.id} data-now={index === stepIndex ? "1" : undefined} data-done={index < stepIndex ? "1" : undefined}>{current.title}</li>
        ))}
        <li data-now={reviewing ? "1" : undefined}>마지막 확인</li>
      </ol>

      {reviewing ? (
        <section className={styles.step} aria-labelledby="writer-step-title">
          <h2 className={styles.stepHead} id="writer-step-title" data-testid="writer-step" tabIndex={-1} ref={headingRef}>
            <span className={styles.stepCount}>마지막 단계</span>적은 내용 확인하기
          </h2>
          <p className={styles.stepNote}>아래 내용이 서식의 해당 칸에 그대로 들어가요. 고칠 곳이 있으면 이전으로 돌아가 주세요.</p>
          {filledSummary.map(group => (
            <div key={group.title}>
              <p className={styles.reviewGroup}>{group.title}</p>
              {group.entries.length ? (
                <ul className={styles.review}>
                  {group.entries.map((entry, index) => (
                    <li key={`${entry.label}-${index}`}>
                      <span className={styles.reviewLabel}>{entry.label}</span>
                      <span className={styles.reviewValue}>{entry.value}</span>
                    </li>
                  ))}
                </ul>
              ) : <p className={styles.empty}>적은 내용이 없어요. 비워 둔 채로 받을 수 있어요.</p>}
            </div>
          ))}
          <div className={styles.manual}>
            <h3>파일을 받은 뒤 직접 해야 하는 것</h3>
            <ul>{template.manual.map(item => <li key={item}>{item}</li>)}</ul>
          </div>
          {!!blockingErrors.length && <p className={styles.failure}>{blockingErrors[0]}</p>}
          {failure && <p className={styles.failure}>{failure}</p>}
          {saved && <p className={styles.done} role="status">작성한 신청서를 내려받았어요. 인쇄해 서명·날인한 뒤 접수기관에 제출해 주세요.</p>}
          <div className={styles.nav}>
            <button type="button" className={`btn btn-ghost btn-lg ${styles.btnWide}`} onClick={() => setStepIndex(steps.length - 1)}>이전</button>
            <button type="button" className={`btn btn-primary btn-lg ${styles.btnWide}`} onClick={download} disabled={busy || !!blockingErrors.length}>
              {busy ? "만드는 중…" : "작성한 신청서 내려받기 (HWPX)"}
            </button>
          </div>
        </section>
      ) : (
        <section className={styles.step} aria-labelledby="writer-step-title">
          <h2 className={styles.stepHead} id="writer-step-title" data-testid="writer-step" tabIndex={-1} ref={headingRef}>
            <span className={styles.stepCount}>{stepIndex + 1}단계 / 전체 {steps.length}단계</span>{step.title}
          </h2>
          {step.description && <p className={styles.stepNote}>{step.description}</p>}
          {step.groups.map(group => renderGroup(group))}
          <div className={styles.nav}>
            {stepIndex > 0 && <button type="button" className={`btn btn-ghost btn-lg ${styles.btnWide}`} onClick={() => setStepIndex(stepIndex - 1)}>이전</button>}
            <button type="button" className={`btn btn-primary btn-lg ${styles.btnWide}`} onClick={() => setStepIndex(stepIndex + 1)}>
              {stepIndex + 1 === steps.length ? "마지막 확인으로" : "다음"}
            </button>
          </div>
        </section>
      )}
    </main>
  );
}
