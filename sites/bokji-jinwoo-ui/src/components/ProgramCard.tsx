import Link from "@/components/SiteLink";
import type { Program } from "@/lib/data/types";
import type { Evaluation } from "@/lib/engine/types";
import { reasonSentence } from "@/lib/client/howto";
import { supportTypes } from "@/lib/client/facets";
import { normalizeText } from "@/lib/data/text";
import { BUCKET_LABEL, type Bucket } from "@/lib/client/v2";
import { ApplyBadge, MANUAL_TITLE, TierBadge, isManual, orgText, orgWhere, ownerText, sectorText } from "./Badges";

export interface Variant {
  p: Program;
  ev: Evaluation;
}

const short = (s: string, n = 40) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

/** 지원형태 라벨 (현금·현물·서비스·이용권 등, 최대 2개) */
export function SupportTags({ p }: { p: Program }) {
  const types = supportTypes(p);
  if (!types.length) return null;
  return (
    <span className="tags" aria-label="지원형태">
      {types.map((t) => (
        <span key={t} className="tag">
          {t}
        </span>
      ))}
    </span>
  );
}

/** 목록 카드: 이름 · 지원형태 · 요약 · 판단 한 문장 · 기관 */
export function ProgramCard({ p, ev, judge, variants }: { p: Program; ev?: Evaluation; judge?: { bucket: Bucket; line: string }; variants?: Variant[] }) {
  const where = orgWhere(p);
  const sector = sectorText(p);
  return (
    <article className="prow" data-testid="program-card" data-tier={ev?.tier} data-bucket={judge?.bucket}>
      <div className="top">
        <h3>
          <Link href={`/p/${encodeURIComponent(p.id)}`}>{p.name}</Link>
        </h3>
        <SupportTags p={p} />
      </div>
      {p.summary && <p className="sum">{normalizeText(p.summary)}</p>}
      {judge ? (
        // (QA 8차) 맞춤 결과·상세와 같은 판정 말 (받으실 수 있어요·신청할 때 확인·답하면 정해져요·맞지 않아요)
        <p className="why" data-testid="card-judge" data-bucket={judge.bucket}>
          <span className={`v2-badge b-${judge.bucket}`}>{BUCKET_LABEL[judge.bucket]}</span> {judge.line}
        </p>
      ) : ev && (
        <p className="why">
          <TierBadge tier={ev.tier} /> · {reasonSentence(ev)}
        </p>
      )}
      <p className="meta">
        <span>{orgText(p)}</span>
        {where && <span>{short(where)}</span>}
        <span>{p.category}</span>
        <ApplyBadge p={p} long />
        {sector && <span>{sector}</span>}
        {isManual(p) && <span title={MANUAL_TITLE} data-testid="manual-badge">수동 보강</span>}
        {p.orgType === "edu_office" && <span>교육청</span>}
        {p.deadline && <span>기간: {short(p.deadline)}</span>}
      </p>
      {variants && variants.length > 0 && (
        <details className="variants">
          <summary data-testid="variants-toggle">같은 이름의 다른 기관 사업 {variants.length}개</summary>
          <ul>
            {variants.map((v) => (
              <li key={v.p.id}>
                <Link href={`/p/${encodeURIComponent(v.p.id)}`}>{v.p.name}</Link>{" "}
                <span className="muted">
                  · {v.p.scope === "national" ? "전국" : v.p.region?.label} · {v.p.provider || ownerText(v.p) || ""}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </article>
  );
}
