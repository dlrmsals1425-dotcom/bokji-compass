"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { MANUAL_TITLE, isManual, orgText, ownerText, reviewText, sectorText } from "@/components/Badges";
import { Icon } from "@/components/Icon";
import { ApplicationForms } from "@/components/ApplicationForms";
import { CHANNEL_LABEL, firstLine, howTo } from "@/lib/client/howto";
import { supportTypes } from "@/lib/client/facets";
import { loadLocalOps, loadProgram } from "@/lib/client/bundles";
import { readQuickResults, useExtras, useMode, useProfile } from "@/lib/client/storage";
import { saveSituation, situationOf } from "@/lib/client/start";
import { parseManwonInput } from "@/lib/client/incomeInput";
import { checkPath, type FindMode } from "@/lib/client/mode";
import { dateLabel, periodEnded } from "@/lib/client/period";
import { BUCKET_LABEL, DIM_BY_ID, answersFor, classifyOne, dimAvailable, dimsFor, explainItem, incomeExplain, plainLine, type ExplainLine, type Situation, type V2Item } from "@/lib/client/v2";
import { SOURCE_LABEL, ORG_TYPE_LABEL, type LocalOperation, type Program } from "@/lib/data/types";
import { blocksLength, clipText, contactNote, normalizeText, relatedTags, textBlocks, tidyQuote, type TextBlock } from "@/lib/data/text";
import { inSheet, readMarks, readPicks, toggleMark, writeMarks, type Marks } from "@/lib/client/sheetMarks";
import { excludedSourceReason, externalFormUrl } from "@/lib/data/formPublication";
const SECTIONS = [
  { id: "sec-target", label: "지원 대상" },
  { id: "sec-benefit", label: "지원 내용" },
  { id: "sec-apply", label: "신청 방법" },
  { id: "sec-contact", label: "문의·출처" },
] as const;

/** 스크롤 위치에 맞춰 현재 탭을 표시한다 (모든 내용은 항상 펼쳐 둔다) */
function useActiveSection(ready: boolean) {
  const [active, setActive] = useState<string>(SECTIONS[0].id);
  useEffect(() => {
    if (!ready) return;
    const onScroll = () => {
      let cur: string = SECTIONS[0].id;
      for (const s of SECTIONS) {
        const el = document.getElementById(s.id);
        if (el && el.getBoundingClientRect().top < 160) cur = s.id;
      }
      setActive(cur);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [ready]);
  return active;
}

const TRUST_LABEL = {
  A: "A · 공식 통합 데이터(복지로·정부24)",
  B: "B · 기관 공식 문서·누리집 기반",
  C: "C · 2차 정보",
} as const;

/** 원문에 없는 항목 표시 (QA 8차: '원문 확인'·'아직 정리되지 않았습니다'·빈칸이 섞여 있던 것을 한 가지로) */
const NOT_IN_SOURCE = "원문에 없어요";

export function Detail({ id }: { id: string }) {
  const profile = useProfile();
  const extras = useExtras();
  const storedMode = useMode();
  const [program, setProgram] = useState<Program | null | undefined>(undefined);
  const [ops, setOps] = useState<LocalOperation[]>([]);
  const [copied, setCopied] = useState(false);
  // (2026-10-23 외부 재점검) 상세 화면에서도 신청 서류 모음에 담기·빼기 — 결과 화면과 같은 상태 (이 탭에만, 사업 id만)
  const [marks, setMarks] = useState<Marks>(() => readMarks());
  const [picks] = useState<string[] | null>(() => readPicks());

  useEffect(() => {
    let alive = true;
    loadProgram(id).then((p) => alive && setProgram(p));
    return () => {
      alive = false;
    };
  }, [id]);

  const sido = profile?.sido ?? null;
  const sigungu = profile?.sigungu ?? null;
  useEffect(() => {
    let alive = true;
    if (id.startsWith("n.") && sigungu) loadLocalOps(id, sido, sigungu).then((o) => alive && setOps(o));
    return () => {
      alive = false;
    };
  }, [id, sido, sigungu]);

  const active = useActiveSection(!!program);
  // 결과 화면과 같은 판단 (상황 먼저 · 쉬운 말) — 저장된 상황 기준, 기기 안에서만
  const mode: FindMode = storedMode ?? "self";
  const sit = useMemo(() => (profile && extras !== undefined ? situationOf(profile, extras, mode) : null), [profile, extras, mode]);
  const item = useMemo(() => (program && sit ? classifyOne(program, sit) : null), [program, sit]);

  if (program === undefined) return <div className="wrap page muted">불러오는 중…</div>;
  if (program === null)
    return (
      <div className="narrow page">
        <h1 className="h1">서비스를 찾을 수 없어요</h1>
        <p className="lead">데이터가 갱신되며 주소가 바뀌었을 수 있어요.</p>
        <Link href="/search" className="btn btn-primary">
          검색으로 찾기
        </Link>
      </div>
    );

  const p = program;
  const placeLabel = p.region?.label ?? "주소지";
  const hasApplyInfo = !!(p.applyMethod || p.contact || p.applyUrl);
  const review = reviewText(p);
  const sector = sectorText(p);
  const share = async () => {
    const url = window.location.href;
    try {
      if (navigator.share) await navigator.share({ title: p.name, text: `${p.name} — 복지나침반`, url });
      else {
        await navigator.clipboard.writeText(`${p.name}\n${url}`);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch {}
  };

  const how = howTo(p, p);
  const types = supportTypes(p);
  const kind = types.length ? types.join(", ") : p.provision?.length ? p.provision.join(", ") : null;
  const back = profile ? { href: "/results", label: "내 결과" } : { href: "/search", label: "서비스 찾기" };
  // 신청 서류 모음 담기·빼기 — 위(제목 아래)와 옆 상자 두 곳 (2026-10-23 외부 3차 점검: 아래에만 있어 찾기 어려움)
  const sheetToggle = picks && (
    <button
      type="button"
      className="link-btn"
      aria-label={`${p.name} — ${inSheet(p.id, marks, picks) ? "신청 서류 모음에서 빼기" : "신청 서류 모음에 담기"}`}
      onClick={() => {
        const next = toggleMark(marks, p.id, !inSheet(p.id, marks, picks), picks);
        writeMarks(next);
        setMarks(next);
      }}
      data-testid="detail-sheet-toggle"
    >
      {inSheet(p.id, marks, picks) ? "빼기" : <><Icon name="listChecks" size={18} /> 신청 서류 모음에 담기</>}
    </button>
  );

  return (
    <div className="wrap page">
      <ol className="crumbs no-print" aria-label="현재 위치">
        <li>
          <Link href="/">
            <Icon name="home" size={14} /> 홈
          </Link>
        </li>
        <li>
          <Link href={back.href}>{back.label}</Link>
        </li>
        <li>
          <span aria-current="page">{p.name}</span>
        </li>
      </ol>

      <header className="card d-head">
        <div className="tags">
          <span className="tag">{orgText(p)}</span>
          <span className="tag gray">{p.category}</span>
          {p.orgType === "edu_office" && <span className="tag gray">교육청 서비스</span>}
          {isManual(p) && <span className="tag gray" title={MANUAL_TITLE} data-testid="manual-badge">수동 보강</span>}
          {sector && <span className="tag gray">{sector}</span>}
        </div>
        <h1 className="h1">{p.name}</h1>
        {p.summary && <p className="lead">{normalizeText(p.summary)}</p>}
        <dl className="keyfacts">
          <div>
            <dt>담당기관</dt>
            <dd>{p.provider || ownerText(p) || ORG_TYPE_LABEL[p.orgType]}</dd>
          </div>
          <div>
            <dt>지원형태</dt>
            <dd>{kind ?? NOT_IN_SOURCE}</dd>
          </div>
          <div>
            <dt>신청 기간</dt>
            <dd>{p.deadline ? firstLine(p.deadline, 40) : NOT_IN_SOURCE}</dd>
          </div>
          <div>
            <dt>신청 창구</dt>
            <dd>{how.channels.length ? how.channels.map((c) => CHANNEL_LABEL[c]).join(", ") : how.place}</dd>
          </div>
        </dl>
        {periodEnded(p) && (
          <p className="notice warm" role="note" data-testid="detail-closed">
            이번 신청 기간이 {dateLabel(periodEnded(p)!)}에 끝났어요 (원문 기준). 해마다 다시 접수하는 사업도 있으니 다음 공고는 문의처에서 확인하세요.
          </p>
        )}
        {((item && sit) || (p.applyType && p.applyType !== "unknown")) && (
          <div className="d-judge">
            {item && sit && (
              <p data-testid="detail-judge" data-bucket={item.bucket}>
                <span className={`v2-badge b-${item.bucket}`}>{BUCKET_LABEL[item.bucket]}</span> {plainLine(item, sit, mode)}{" "}
                <span className="muted small">{`(${mode === "parent" ? "부모님 상황" : "답하신 상황"} 기준)`}</span>
              </p>
            )}
            {p.applyType && p.applyType !== "unknown" && (
              <p data-testid="apply-type">
                {p.applyType === "self"
                  ? "직접 신청해야 받을 수 있습니다."
                  : p.applyType === "auto"
                    ? "대상이 되면 따로 신청하지 않아도 자동으로 지급·연계되는 경우가 많습니다. 받고 있지 않다면 문의처나 주민센터에 확인해 보세요."
                    : "기관·학교·시설이 대상자를 추천하거나 선정하는 사업입니다. 해당될 것 같다면 문의처에 확인해 보세요."}
                {p.applyReason && <span className="muted small">{` (근거: ${tidyQuote(p.applyReason)})`}</span>}
              </p>
            )}
          </div>
        )}
        {picks && (
          <p className="no-print" data-testid="detail-sheet-top">
            {inSheet(p.id, marks, picks) && (
              <span className="small">
                <Icon name="check" size={16} /> 신청 서류 모음에 있음 ·{" "}
              </span>
            )}
            {sheetToggle}
          </p>
        )}
      </header>

      <div className="layout" style={{ marginTop: "1.5rem" }}>
        <div>
          <nav className="dtabs no-print" aria-label="상세 내용 바로가기">
            {SECTIONS.map((s) => (
              <a key={s.id} href={`#${s.id}`} aria-current={active === s.id ? "true" : undefined}>
                {s.label}
              </a>
            ))}
          </nav>

          <section className="dsec" id="sec-target" aria-labelledby="h-target">
            <h2 id="h-target">지원 대상</h2>
            <h3 className="h3">내 상황과 비교한 결과</h3>
            {item && sit ? (
              <>
                <ExplainBlock item={item} sit={sit} mode={mode} />
                <RuleNote p={p} />
              </>
            ) : (
              <p className="inset">
                <Link href="/situation">내 상황으로 지원 조건 확인하기</Link>
              </p>
            )}
            {(p.target || p.criteria) && (
              <dl className="summary" style={{ marginTop: "1.25rem" }}>
                {p.target && (
                  <>
                    <dt>지원 대상</dt>
                    <dd>
                      <LongText text={p.target} />
                    </dd>
                  </>
                )}
                {p.criteria && (
                  <>
                    <dt>선정 기준</dt>
                    <dd>
                      <LongText text={p.criteria} />
                    </dd>
                  </>
                )}
              </dl>
            )}
          </section>

          <section className="dsec" id="sec-benefit" aria-labelledby="h-benefit">
            <h2 id="h-benefit">지원 내용</h2>
            <dl className="summary">
              {p.benefit && (
                <>
                  <dt>지원 내용</dt>
                  <dd>
                    <LongText text={p.benefit} />
                  </dd>
                </>
              )}
              {kind && (
                <>
                  <dt>지원 형태</dt>
                  <dd>{kind}</dd>
                </>
              )}
              {p.laws?.length ? (
                <>
                  <dt>근거</dt>
                  <dd>{p.laws.join("\n")}</dd>
                </>
              ) : null}
              {p.tags?.length ? (
                <>
                  <dt>관련 주제</dt>
                  <dd>{relatedTags(p.tags).join(", ")}</dd>
                </>
              ) : null}
            </dl>
            {!p.benefit && <p className="muted">세부 지원 내용은 공식 원문에서 확인하세요.</p>}
            {ops.length > 0 && (
              <>
                <h3 className="h3" style={{ marginTop: "1.5rem" }}>
                  우리 지역 운영 정보
                </h3>
                <ul className="ops">
                  {ops.map((o, i) => (
                    <li key={i}>
                      <strong>{o.name}</strong>
                      {o.provider && <div>운영: {o.provider}</div>}
                      {o.description && <div className="muted">{o.description}</div>}
                      {o.contact && <div>{`문의: ${o.contact}`}</div>}
                      {o.applyMethod && <div style={{ whiteSpace: "pre-line" }}>{`신청: ${shortText(o.applyMethod, 200)}`}</div>}
                      {o.url && (
                        <a href={o.url} target="_blank" rel="noopener noreferrer">
                          원문 (새 창)
                        </a>
                      )}
                      <div className="small muted">
                        {o.updatedAt ? `원문 기준일 ${o.updatedAt} · ` : ""}
                        {o.source ? SOURCE_LABEL[o.source] : SOURCE_LABEL.icare}
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>

          <section className="dsec" id="sec-apply" aria-labelledby="h-howto">
            <h2 id="h-howto">신청 방법</h2>
            <ol className="howto compact">
              <li>
                <span className="n" aria-hidden="true">1</span>
                <div>
                  <h3>신청처 확인</h3>
                  <p>{how.place}</p>
                </div>
              </li>
              <li>
                <span className="n" aria-hidden="true">2</span>
                <div>
                  <h3>서류 준비</h3>
                  <p>{how.bring.length ? how.bring.join(", ") : "신분증, 그 밖의 서류는 신청처에 확인"}</p>
                </div>
              </li>
              <li>
                <span className="n" aria-hidden="true">3</span>
                <div>
                  <h3>신청</h3>
                  <p>{how.channels.length ? how.channels.map((c) => CHANNEL_LABEL[c]).join(", ") : how.place}</p>
                </div>
              </li>
            </ol>
            <dl className="summary" style={{ marginTop: "1.25rem" }}>
              {p.applyMethod && (
                <>
                  <dt>신청 방법</dt>
                  <dd>
                    <LongText text={p.applyMethod} />
                    {p.applyNote && (
                      <p className="small muted" data-testid="apply-note">
                        수동 보강 — 원문에 신청 방법이 없어 공식 누리집에서 확인해 옮겼어요 ({p.applyNote.checkedAt} 확인,{" "}
                        <a href={p.applyNote.source} target="_blank" rel="noopener noreferrer">
                          출처
                        </a>
                        ).
                      </p>
                    )}
                  </dd>
                </>
              )}
              {p.documents && (
                <>
                  <dt>구비 서류</dt>
                  <dd>
                    <LongText text={p.documents} />
                  </dd>
                </>
              )}
              {p.deadline && (
                <>
                  <dt>신청 기간</dt>
                  <dd>{p.deadline}</dd>
                </>
              )}
            </dl>
            {!p.applyMethod && <p className="muted">{how.fallback}</p>}
            <ApplicationForms key={p.id} program={p} parentMode={mode === "parent"} preferredSigungu={sigungu} />
          </section>

          <section className="dsec" id="sec-contact" aria-labelledby="h-src">
            <h2 id="h-src">문의·출처</h2>
            <ul className="ops" data-testid="sources">
              {p.sources.map((s, i) => (
                <li key={i}>
                  <strong>{SOURCE_LABEL[s.source]}</strong>
                  <div className="small">
                    원문 기준일: {s.updatedAt ?? "원문에 표기 없음"} · 수집일: {s.fetchedAt}
                  </div>
                  {s.url && (
                    <a className="small" href={s.url} target="_blank" rel="noopener noreferrer">
                      원문 링크 (새 창)
                    </a>
                  )}
                </li>
              ))}
            </ul>
            <p className="rule-note">
              {`신뢰도 ${TRUST_LABEL[p.trust]}`}
              {review ? ` · ${review}` : ""}
              {isManual(p) ? " · 수동 보강 (공식 누리집 확인, 최종 사람 검수 대기)" : ""}
              {p.mergedCount && p.mergedCount > 1 ? ` · ${p.mergedCount}개 원천에서 같은 사업으로 합침` : ""}
            </p>
          </section>
        </div>

        <aside className="side">
          <section className="side-box apply" aria-labelledby="h-apply">
            <h2 id="h-apply">
              <Icon name="fileText" size={18} /> 신청·문의
            </h2>
            <dl className="summary stacked">
              <dt>소관기관</dt>
              <dd>{ownerText(p) ?? NOT_IN_SOURCE}</dd>
              {p.provider && (
                <>
                  <dt>집행·신청처</dt>
                  <dd>{p.provider}</dd>
                </>
              )}
              <dt>기관 유형</dt>
              <dd>{ORG_TYPE_LABEL[p.orgType]}</dd>
              <dt>문의</dt>
              <dd>
                {p.contact ?? NOT_IN_SOURCE}
                {contactNote(p.contact) && (
                  <span className="small" data-testid="contact-note" style={{ display: "block" }}>
                    ※ {contactNote(p.contact)}
                  </span>
                )}
              </dd>
            </dl>
            {!hasApplyInfo && (
              <div className="inset" data-testid="apply-fallback">
                <p>
                  <strong>원문에 신청처·연락처가 없어요.</strong>
                </p>
                <p>
                  {p.scope === "national"
                    ? "주소지 읍면동 행정복지센터(주민센터) 또는 시군구청 담당 부서에 문의하세요."
                    : p.scope === "sigungu"
                      ? `${placeLabel.split(" ").pop()}청 담당 부서 또는 주소지 읍면동 행정복지센터에 문의하세요.`
                      : `${placeLabel} 시·도청 담당 부서, 주소지 시군구청 또는 읍면동 행정복지센터에 문의하세요.`}
                </p>
                <p>보건복지상담센터 129 · 정부민원안내 110</p>
              </div>
            )}
            <div className="side-actions">
              {externalFormUrl(p.applyUrl) && (
                <a href={externalFormUrl(p.applyUrl)!} target="_blank" rel="noopener noreferrer" className="btn btn-primary">
                  온라인 신청·관련 누리집 <Icon name="externalLink" size={18} />
                </a>
              )}
              {externalFormUrl(p.url) ? (
                <a href={externalFormUrl(p.url)!} target="_blank" rel="noopener noreferrer" className="btn btn-ghost" data-testid="official-link">
                  공식 원문 보기 <Icon name="externalLink" size={18} />
                </a>
              ) : (
                <a href="https://www.bokjiro.go.kr" target="_blank" rel="noopener noreferrer" className="btn btn-ghost">
                  복지로에서 &lsquo;{p.name}&rsquo; 검색 <Icon name="externalLink" size={18} />
                </a>
              )}
            </div>
            {excludedSourceReason(p.applyUrl) && <p className="small muted">{excludedSourceReason(p.applyUrl)}</p>}
            <p className="small muted" style={{ marginTop: "0.75rem" }}>
              <Icon name="phone" size={14} className="icon-inline" /> 궁금하시면 보건복지상담센터(☎129)에 물어보세요
            </p>
          </section>
          <section className="side-box no-print">
            <ul className="link-list">
              {picks && (
                <li data-testid="detail-sheet">
                  {inSheet(p.id, marks, picks) && (
                    <span className="small">
                      <Icon name="check" size={16} /> 신청 서류 모음에 있음 ·{" "}
                    </span>
                  )}
                  {sheetToggle}
                </li>
              )}
              <li>
                <button type="button" className="link-btn" onClick={() => window.print()}>
                  <Icon name="printer" size={18} /> 인쇄하거나 PDF로 저장
                </button>
              </li>
              <li>
                <button type="button" className="link-btn" onClick={share}>
                  <Icon name="share" size={18} /> 이 서비스 공유
                </button>
                {copied && (
                  <span role="status" className="small muted">
                    {" "}
                    링크를 복사했어요
                  </span>
                )}
              </li>
            </ul>
          </section>
        </aside>
      </div>
    </div>
  );
}

function RuleNote({ p }: { p: Program }) {
  const r = p.rule;
  let text: string;
  if (r.review === "verified") text = `검수 규칙 · ${r.reviewer ?? "검수자"} ${r.reviewedAt ?? ""}`;
  else if (r.review === "curated")
    text = "원문 대조 완료 · 최종 검수 중";
  else if (r.review === "structured")
    text = "공공서비스 지원조건 기준입니다. 재산 등 세부 요건은 신청처에 확인하세요.";
  else if (r.origin === "gov24_conditions")
    text = "지역 지원조건 검수 전 · 가능성만 안내합니다. 신청처 확인이 필요해요.";
  else if (r.origin === "none") text = "비교할 지원조건이 없어요. 공식 안내나 신청처에서 확인하세요.";
  else text = "자동 정리한 조건으로 검수 전입니다. 신청처 확인이 필요해요.";
  return (
    <div className="rule-note">
      <p>{text}</p>
      {r.evidence && (
        <p style={{ marginTop: 4 }}>
          근거 구절: &ldquo;{clipText(tidyQuote(r.evidence), 160)}&rdquo;
        </p>
      )}
    </div>
  );
}

/** 긴 원문은 접어서 보여 준다 */
const shortText = (t: string, n: number) => {
  const s = normalizeText(t);
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
};

/** 원문 긴 글: 줄바꿈은 문단으로, '○ · - * •' 글머리표 줄은 목록으로 (낱말은 그대로). 길면 앞부분만 + '원문 더 보기' */
function LongText({ text, limit = 280 }: { text: string; limit?: number }) {
  const [open, setOpen] = useState(false);
  const blocks = useMemo(() => textBlocks(text), [text]);
  const long = blocksLength(blocks) > limit + 40;
  return (
    <div className="rich">
      <Blocks blocks={open || !long ? blocks : clipBlocks(blocks, limit)} />
      {long && (
        <button type="button" className="btn btn-text no-print" aria-expanded={open} onClick={() => setOpen((o) => !o)} style={{ display: "flex" }}>
          {open ? "접기" : "원문 더 보기"}
        </button>
      )}
    </div>
  );
}

function Blocks({ blocks }: { blocks: TextBlock[] }) {
  return (
    <>
      {blocks.map((b, i) =>
        b.kind === "p" ? (
          <p key={i}>{b.text}</p>
        ) : (
          <ul key={i}>
            {b.items.map((it, j) => (
              <li key={j} data-m={it.marker} className={it.level === 2 ? "lv2" : undefined}>
                {it.text}
              </li>
            ))}
          </ul>
        ),
      )}
    </>
  );
}

/** 앞에서부터 글자 수 limit까지 (넘는 곳은 낱말 단위로 자르고 '…') */
function clipBlocks(blocks: TextBlock[], limit: number): TextBlock[] {
  const cut = (t: string, n: number) => t.slice(0, n).replace(/\s+\S*$/, "") + "…";
  const out: TextBlock[] = [];
  let left = limit;
  for (const b of blocks) {
    if (left <= 0) break;
    if (b.kind === "p") {
      out.push(b.text.length > left ? { kind: "p", text: cut(b.text, left) } : b);
      left -= b.text.length;
    } else {
      const items: typeof b.items = [];
      for (const it of b.items) {
        if (left <= 0) break;
        items.push(it.text.length > left ? { ...it, text: cut(it.text, left) } : it);
        left -= it.text.length;
      }
      out.push({ kind: "ul", items });
    }
  }
  return out;
}

/** 내 답과 조건 비교: 맞은 것 · 어긋난 것 · 아직 모르는 것 (+ 정할 수 있는 질문은 바로 여기서) */
function ExplainBlock({ item, sit, mode }: { item: V2Item; sit: Situation; mode: FindMode }) {
  const ex = explainItem(item, sit);
  const [skipped, setSkipped] = useState<string[]>([]);
  // 바로 정할 수 있는 질문 먼저, 그다음 이 혜택 조건에 걸린 나머지 '모름' 질문 (최대 3개)
  const open = item.bucket === "ask" || item.bucket === "office";
  const rest = open ? dimsFor(item.s.program).filter((id) => dimAvailable(DIM_BY_ID[id], sit) && DIM_BY_ID[id].isUnknown(sit)) : [];
  const dims = [...new Set([...item.dims, ...rest])].filter((d) => !skipped.includes(d)).slice(0, 3);
  const apply = (next: Situation) => saveSituation(next, mode, undefined, readQuickResults());
  const who = mode === "parent" ? "부모님 답" : "내 답";
  const list = (lines: ExplainLine[]) => (
    <ul>
      {lines.map((l) => (
        <li key={l.cond}>
          <span>{l.cond}</span>
          <span className="ans">
            {who}: <strong>{l.answer ?? "답하지 않음"}</strong>
          </span>
        </li>
      ))}
    </ul>
  );
  return (
    <div className="explain" data-testid="explain">
      {ex.failed.length > 0 && (
        <div className="bad" data-testid="explain-failed">
          <h3>
            <Icon name="x" size={18} /> 맞지 않는 조건
          </h3>
          {list(ex.failed)}
        </div>
      )}
      {ex.matched.length > 0 && (
        <div className="ok" data-testid="explain-matched">
          <h3>
            <Icon name="check" size={18} /> 맞는 조건
          </h3>
          {list(ex.matched)}
        </div>
      )}
      {ex.unknown.length > 0 && (
        <div className="unk" data-testid="explain-unknown">
          <h3>
            <Icon name="alert" size={18} /> 아직 모르는 조건
          </h3>
          {list(ex.unknown)}
        </div>
      )}
      {dims.length > 0 && (
        <div className="inline-q no-print" data-testid="detail-questions">
          <p>
            <strong>추가 확인</strong>
          </p>
          {dims.map((id) => {
            const d = DIM_BY_ID[id];
            return (
              <div key={id} data-testid={`detail-q-${id}`} style={{ marginTop: "0.75rem" }}>
                <p className="v2-q-t">{d.q(mode, sit)}</p>
                {id === "income" ? (
                  <DetailIncome sit={sit} onApply={apply} onSkip={() => setSkipped((s) => [...s, id])} />
                ) : (
                  <div className="btn-row">
                    {answersFor(d, sit).map((a) => (
                      <button key={a.key} type="button" className="btn btn-ghost btn-sm" onClick={() => apply(a.apply(sit))} data-testid={`detail-a-${id}-${a.key}`}>
                        {a.label}
                      </button>
                    ))}
                    <button type="button" className="btn btn-quiet" onClick={() => setSkipped((s) => [...s, id])}>
                      모름
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {ex.notes.length > 0 && (
        <div className="unk" data-testid="explain-notes">
          <h3>
            <Icon name="info" size={18} /> 신청할 때 확인할 것
          </h3>
          <ul>
            {ex.notes.map((n) => (
              <li key={n} style={{ gridTemplateColumns: "minmax(0, 1fr)" }}>
                {n}
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="small muted">
        <Link href={checkPath(mode)}>상황 고치기</Link> · 판단은 공개된 조건과 답하신 내용만으로 한 안내이고, 실제 선정은 기관 심사로 정해져요.
      </p>
    </div>
  );
}

function DetailIncome({ sit, onApply, onSkip }: { sit: Situation; onApply: (s: Situation) => void; onSkip: () => void }) {
  const [t, setT] = useState("");
  const size = sit.profile.householdSize === "unknown" ? null : sit.profile.householdSize;
  // 적은 글자를 바꾸지 않고 해석 (QA 8차) — 알아볼 수 없으면 확인 단추를 막고 이유를 보여 준다
  const parsed = parseManwonInput(t);
  const n = parsed.value;
  const ex = n !== null && size ? incomeExplain(n, size) : null;
  return (
    <div>
      <div className="btn-row">
        <label htmlFor="dq-income" className="sr-only">
          한 달 소득 (만원)
        </label>
        <input id="dq-income" className="input v2-income-in" inputMode="decimal" placeholder="예: 300" value={t} maxLength={12}
          aria-invalid={parsed.error ? true : undefined}
          onChange={(e) => setT(e.target.value)} />
        <span>만원 / 월</span>
        <button type="button" className="btn btn-ghost btn-sm" disabled={n === null} onClick={() => n !== null && onApply({ ...sit, x: { ...sit.x, incomeManwon: n } })}>
          확인
        </button>
        <button type="button" className="btn btn-quiet" onClick={onSkip}>
          모름
        </button>
      </div>
      {parsed.error && (
        <p className="error" id={"dq-income-err"} role="alert">
          {parsed.error}
        </p>
      )}
      {ex && (
        <p className="small" aria-live="polite">
          {ex.line}
        </p>
      )}
    </div>
  );
}
