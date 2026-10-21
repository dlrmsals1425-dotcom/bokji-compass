"use client";
/**
 * 결과 맨 위 '한눈에 보기' (금액·기한 중심 요약):
 *  1) 받으실 수 있어요 N개 + 원문에 적힌 금액 (원문 기준 최대, 더하지 않음)
 *  2) 한 가지만 더 답하시면 N개가 정해져요 + 그중 금액이 있는 것 + 그 자리에서 답하기
 *  3) 신청 기한이 있는 것 (가까운 순, 지난 것·모르는 것은 안 보임)
 */
import { useEffect, useState } from "react";
import Link from "@/components/SiteLink";
import { HH_LABEL, householdLabel, moneyRows, summaryDueRows } from "@/lib/client/money";
import { loadProgram } from "@/lib/client/bundles";
import { answersFor, needsChildren, teenSelf, type DimId, type Situation, type V2Item, type V2View } from "@/lib/client/v2";
import type { FindMode } from "@/lib/client/mode";
import type { Program } from "@/lib/data/types";
import { IncomeAsk } from "./IncomeAsk";
import styles from "./results.module.css";

type Q = V2View["questions"][number];

export function Summary({ view, picks, sit, mode, question, onApply, onSkip, now }: { view: V2View; picks: V2Item[][]; sit: Situation; mode: FindMode; question?: Q; onApply: (s: Situation) => void; onSkip: (d: DimId) => void; now?: Date }) {
  const pickIds = new Set(picks.map((g) => g[0].s.program.id));
  const lead = (gs: V2Item[][]) => gs.map((g) => g[0].s.program);
  // 먼저 확인할 5가지를 앞에, 그다음 관련도 순서
  const firstPicks = (ps: Program[]) => [...ps.filter((p) => pickIds.has(p.id)), ...ps.filter((p) => !pickIds.has(p.id))];
  const fitMoney = moneyRows(firstPicks(lead(view.fit)), 4);
  const decided = question ? view.ask.filter((g) => question.keys.includes(g[0].s.group)) : [];
  // 10대 본인에게는 자녀가 있어야 받는 사업(기저귀·부모급여 등)을 금액 예시로 보이지 않음 (QA 7차 T1)
  const askMoney = moneyRows(firstPicks(lead(decided)).filter((p) => !(teenSelf(sit) && needsChildren(p))), 3);
  const dues = summaryDueRows(lead(picks), lead(view.fit), lead(view.office), sit.profile.children, now ?? new Date(), 4);
  // byHh: '가구원 수에 따라 달라요'인 줄만 상세 원문(지원내용)을 불러와 내 가구원 수 칸으로 (이 기기 안에서만, 많아야 7건)
  const hhIds = [...fitMoney, ...askMoney].filter((r) => r.label === HH_LABEL).map((r) => r.program.id).join("|");
  const [benefits, setBenefits] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!hhIds) return;
    let alive = true;
    Promise.all(hhIds.split("|").map((id) => loadProgram(id).catch(() => null))).then((ps) => {
      if (!alive) return;
      const out: Record<string, string> = {};
      ps.forEach((p) => p?.benefit && (out[p.id] = p.benefit));
      setBenefits((b) => ({ ...b, ...out }));
    });
    return () => {
      alive = false;
    };
  }, [hhIds]);
  const size = sit.profile.householdSize;
  const labelOf = (r: (typeof fitMoney)[number]) => (r.label === HH_LABEL ? householdLabel(r.money, benefits[r.program.id], size) ?? r.label : r.label);
  const parent = mode === "parent";
  if (!view.fit.length && !question && !dues.length) return null;
  return (
    <section className="v2-summary" aria-labelledby="sum-h" data-testid="money-summary">
      <h2 className="sum-title" id="sum-h">
        한눈에 보기
      </h2>
      <ul className="sum-rows">
        <li data-testid="sum-fit">
          <p className="sum-k">
            {parent ? "부모님이 " : ""}받으실 수 있어요 <strong>{view.fit.length.toLocaleString("ko-KR")}개</strong>
          </p>
          {fitMoney.length > 0 ? (
            <ul className="sum-money">
              {fitMoney.map((r) => ({ ...r, label: labelOf(r) })).map(({ program: p, money, label }) => (
                <li key={p.id}>
                  <Link href={`/p/${encodeURIComponent(p.id)}`}>{p.name}</Link> <span className="sum-amt" title={`원문: ${money.quote}`}>{label}</span>
                </li>
              ))}
            </ul>
          ) : view.fit.length > 0 ? (
            <p className="small muted">원문에 금액이 적힌 것은 없어요.</p>
          ) : null}
        </li>
        {question && (
          <li data-testid="sum-next">
            <p className="sum-k">
              추가 확인 <strong>{question.groups.toLocaleString("ko-KR")}개</strong>
            </p>
            <p className="small">{question.dim.q(mode, sit)}</p>
            {askMoney.length > 0 && (
              <details className={styles.summaryExamples}>
                <summary>관련 혜택</summary>
                <p className="small muted" data-testid="sum-next-money">
                  {askMoney.map((r) => `${r.program.name} ${labelOf(r)}`).join(" · ")}
                </p>
              </details>
            )}
            {question.dim.id === "income" ? (
              <IncomeAsk sit={sit} onApply={onApply} onSkip={() => onSkip("income")} idPrefix="sum" testPrefix="sum" />
            ) : (
              <div className="btn-row v2-answers">
                {answersFor(question.dim, sit).map((a) => (
                  <button key={a.key} type="button" className="btn btn-ghost btn-sm" onClick={() => onApply(a.apply(sit))} data-testid={`sum-a-${question.dim.id}-${a.key}`}>
                    {a.label}
                  </button>
                ))}
                <button type="button" className="btn btn-quiet" onClick={() => onSkip(question.dim.id)} data-testid={`sum-skip-${question.dim.id}`}>
                  건너뛰기
                </button>
              </div>
            )}
          </li>
        )}
        {dues.length > 0 && (
          <li data-testid="sum-due">
            <p className="sum-k">신청 기한이 있는 것</p>
            <ul className="sum-money">
              {dues.map(({ program: p, due }) => (
                <li key={p.id}>
                  <Link href={`/p/${encodeURIComponent(p.id)}`}>{p.name}</Link> <span className="sum-amt">{due.text}</span> <span className="small muted">({due.note})</span>
                </li>
              ))}
            </ul>
          </li>
        )}
      </ul>
      <p className="small muted sum-foot">
        원문 기준 최대 금액입니다. 실제 금액과 중복 수급 여부는 조건에 따라 달라요.
      </p>
    </section>
  );
}
