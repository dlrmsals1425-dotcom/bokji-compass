/**
 * 쉬운 찾기 (2026-10-21 인터뷰: "부모님이 직접 쓰기엔 어렵다 — 예/아니요로만, 18~19번 누르면 끝까지").
 * 질문 따라 찾기와 같은 질문(v2 DIMS)·같은 판정을 쓰고, 보기가 여럿인 질문만 예/아니요 여러 번으로 나눠 묻는다.
 *  - 나이: '만 65세 이상인가요?'처럼 경계만 물어 구간을 좁힌다 (끝까지 가면 질문 따라 찾기의 나이 보기 하나)
 *  - 가구원 수·소득: 차례로 물어 질문 따라 찾기와 같은 보기 하나로 정한다 (판정 규칙은 그대로)
 *  - '잘 모르겠어요'는 그 질문을 건너뛴다 (아니요로 보지 않는다)
 * 답은 이 기기 안에서만 쓰고 주소에는 싣지 않는다.
 */
import { ageRange, medianWon, CHILD_LABEL, INCOME_BANDS, type ChildBucket } from "../engine/profile";
import { FLOW_DIM_BY_ID, childrenApply, flowAnswers, nextQuestion, rarePicks, type FlowQuestionId, type FlowStep } from "./guided";
import type { FindMode } from "./mode";
import { DIM_BY_ID, ageBoundsOf, type Answer, type DimId, type Situation } from "./v2";

/** 쉬운 찾기 기본 질문 수(누르는 횟수) — 넘으면 끝 화면에서 '더 답하기' */
export const EASY_LIMIT = 18;

export type EasyResolve =
  | { kind: "ask"; q: string; help?: string }
  | { kind: "done"; apply: (s: Situation) => Situation; label: string }
  /** 이 상황에서는 예/아니요로 물을 수 없음 (예: 가구원 수를 몰라 소득 금액을 정할 수 없음) */
  | { kind: "skip" };

const subj = (m: FindMode, self: string, parent: string) => (m === "parent" ? parent : self);
const manwon = (won: number) => Math.floor(won / 10000).toLocaleString("ko-KR");
const done = (a: Answer): EasyResolve => ({ kind: "done", apply: a.apply, label: a.label });
const byKey = (list: Answer[], key: string) => list.find((a) => a.key === key)!;

/** 차례로 묻기: 앞에서부터 '이것인가요?' — 예면 그 보기, 모두 아니요면 마지막 보기 */
function ladder(list: Answer[], trail: readonly boolean[], ask: (a: Answer, i: number) => string, help?: string): EasyResolve {
  const yes = trail.indexOf(true);
  if (yes >= 0) return done(list[yes]);
  if (trail.length >= list.length - 1) return done(list[list.length - 1]);
  return { kind: "ask", q: ask(list[trail.length], trail.length), help };
}

/**
 * 반으로 나눠 묻기 (오름차순 보기): '이 경계 이상인가요?' 예면 위쪽, 아니요면 아래쪽.
 * first 가 있으면 첫 경계를 그 보기로 (나이 65세처럼 판정에서 가장 많이 갈리는 곳).
 */
function bisect(list: Answer[], trail: readonly boolean[], ask: (upper: Answer) => string, first?: number, help?: string): EasyResolve {
  let lo = 0;
  let hi = list.length - 1;
  const split = () => (lo === 0 && hi === list.length - 1 && first !== undefined && first > 0 && first <= hi ? first : Math.ceil((lo + hi) / 2));
  for (const t of trail) {
    const m = split();
    if (t) lo = m;
    else hi = m - 1;
  }
  if (lo >= hi) return done(list[lo]);
  return { kind: "ask", q: ask(list[split()]), help };
}

const ageLow = (a: Answer) => ageRange(a.key as Exclude<Situation["profile"]["age"], "unknown">)[0];

/**
 * 한 질문(dim)을 예/아니요로 물을 때 지금까지의 답(trail)으로 다음 할 일.
 * 보기 목록은 질문 따라 찾기와 같다(flowAnswers) — 끝에 정해지는 값도 같다.
 */
export function easyResolve(id: FlowQuestionId, s: Situation, trail: readonly boolean[]): EasyResolve {
  const m: FindMode = s.mode ?? "self";
  const list = flowAnswers(FLOW_DIM_BY_ID[id], s);
  switch (id) {
    case "age": {
      const i65 = list.findIndex((a) => ageLow(a) === 65);
      return bisect(list, trail, (a) => subj(m, `만 ${ageLow(a)}세 이상인가요?`, `부모님이 만 ${ageLow(a)}세 이상이신가요?`), i65 >= 0 ? i65 : undefined);
    }
    case "alone":
      return ladder(list, trail, (a) =>
        a.key === "yes" ? subj(m, "혼자 사세요?", "부모님이 혼자 사세요?")
          : subj(m, `함께 사는 가족이 본인 포함 ${a.key}명인가요?`, `부모님 댁에 사는 분이 부모님 포함 ${a.key}명인가요?`),
        "소득 기준과 1인 가구 혜택이 이 답으로 정해져요.");
    case "income": {
      const size = s.profile.householdSize;
      if (size === "unknown") return { kind: "skip" };
      return bisect(list, trail, (a) => {
        const i = INCOME_BANDS.indexOf(a.key as (typeof INCOME_BANDS)[number]);
        const won = medianWon(Number(INCOME_BANDS[i - 1]), size);
        return subj(m, `가구 전체의 한 달 소득이 ${manwon(won)}만원보다 많은가요?`, `부모님 가구의 한 달 소득이 ${manwon(won)}만원보다 많은가요?`);
      }, undefined, "일해서 버는 돈·연금·임대료를 모두 더한 금액이에요. 대략이면 충분해요.");
    }
    case "support": {
      // 아니요 → 받지 않음 / 예 → 생계 → 의료 → 주거 → (모두 아니면) 차상위
      if (trail.length === 0) return { kind: "ask", q: DIM_BY_ID.support.q(m), help: "‘수급자’, ‘차상위’라고 적힌 혜택은 이 답으로 정해져요." };
      if (!trail[0]) return done(byKey(list, "none"));
      const levels = ["livelihood", "medical", "housing", "near_poverty"].map((k) => byKey(list, k));
      const text: Record<string, string> = {
        livelihood: subj(m, "생계급여(매달 생활비)를 받으세요?", "부모님이 생계급여(매달 생활비)를 받으세요?"),
        medical: subj(m, "의료급여(병원비를 의료급여증으로)를 받으세요?", "부모님이 의료급여(병원비를 의료급여증으로)를 받으세요?"),
        housing: subj(m, "주거급여(월세·집수리 지원)를 받으세요?", "부모님이 주거급여(월세·집수리 지원)를 받으세요?"),
      };
      return ladder(levels, trail.slice(1), (a) => text[a.key]);
    }
    case "disability": {
      if (trail.length === 0) return { kind: "ask", q: DIM_BY_ID.disability.q(m) };
      if (!trail[0]) return done(byKey(list, "none"));
      if (trail.length === 1) return { kind: "ask", q: subj(m, "심한 장애(예전 1~3급)인가요?", "심한 장애(예전 1~3급)이신가요?") };
      return done(byKey(list, trail[1] ? "severe" : "mild"));
    }
    case "housing": {
      const order = ["own", "monthly", "public_rental", "jeonse"].map((k) => byKey(list, k));
      const text: Record<string, string> = {
        own: subj(m, "사는 집이 본인(가족) 소유인가요?", "부모님 댁이 부모님(가족) 소유인가요?"),
        monthly: "월세로 사세요?",
        public_rental: "LH·SH 같은 공공임대주택인가요?",
        jeonse: "전세로 사세요?",
      };
      const yes = trail.indexOf(true);
      if (yes >= 0) return done(order[yes]);
      // 모두 아니요 → 그 밖의 형태 (정하지 않음)
      if (trail.length >= order.length) return { kind: "skip" };
      return { kind: "ask", q: text[order[trail.length].key] };
    }
    case "activity": {
      if (trail.length === 0) return { kind: "ask", q: subj(m, "지금 돈을 버는 일을 하세요?", "부모님이 지금 돈을 버는 일을 하세요?") };
      if (trail[0]) {
        if (trail.length === 1) return { kind: "ask", q: "회사·기관에 다니세요? (아니요면 자영업)" };
        return done(byKey(list, trail[1] ? "employed" : "self_employed"));
      }
      // 학생은 부모님 찾기·30세 이상이면 묻지 않는다 (인터뷰 시연: 70대 부모님께 '학생인가요?')
      const student = m !== "parent" && (ageBoundsOf(s)?.[0] ?? 0) < 30;
      const rest = (student ? ["job_seeking", "student", "none"] : ["job_seeking", "none"]).map((k) => byKey(list, k));
      return ladder(rest, trail.slice(1), (a) => (a.key === "job_seeking" ? "일자리를 찾고 계세요?" : "학생인가요?"));
    }
    case "daycare": {
      if (trail.length === 0) return { kind: "ask", q: subj(m, "어린이집이나 유치원에 다니는 자녀가 있나요?", "어린이집이나 유치원에 다니는 손주가 있나요?"), help: DIM_BY_ID.daycare.help };
      if (!trail[0]) return done(byKey(list, "no"));
      if (trail.length === 1) return { kind: "ask", q: subj(m, "집에서 키우는 자녀도 있나요?", "집에서 키우는 손주도 있나요?") };
      return done(byKey(list, trail[1] ? "both" : "yes"));
    }
    case "family": {
      // 자녀 있음? → 임신·출산 예정? 두 답으로 자녀·출산 상황 하나
      if (trail.length === 0) return { kind: "ask", q: "함께 사는 자녀가 있나요?" };
      if (trail.length === 1) return { kind: "ask", q: "임신 중이거나 출산 예정인가요?" };
      const key = trail[0] ? (trail[1] ? "both" : "children") : trail[1] ? "expecting" : "none";
      return done(byKey(list, key));
    }
    case "children": {
      // 자녀 나이대마다 '있나요?' — 여럿이면 모두 '예' (임신은 앞의 자녀·출산 질문을 따른다)
      const buckets: ChildBucket[] = ["0-1", "2-5", "6-12", "13-18", "19+"];
      if (trail.length < buckets.length) {
        const b = buckets[trail.length];
        return { kind: "ask", q: `${CHILD_LABEL[b]} 자녀가 있나요?`, help: trail.length === 0 ? "자녀가 여럿이면 해당하는 나이대마다 ‘예’를 눌러 주세요." : undefined };
      }
      const on = buckets.filter((_, i) => trail[i]);
      if (!on.length) return { kind: "skip" };
      const expecting = s.x.family === "both" || s.x.family === "expecting";
      const all: ChildBucket[] = expecting ? ["pregnant", ...on] : on;
      return { kind: "done", apply: (x) => childrenApply(x, all, null), label: on.map((c) => CHILD_LABEL[c]).join(", ") };
    }
    default: {
      // 예/아니요 질문은 그대로
      const d = DIM_BY_ID[id as DimId];
      if (trail.length === 0) return { kind: "ask", q: d.q(m, s), help: d.help };
      return done(byKey(list, trail[0] ? "yes" : "no"));
    }
  }
}

/** 다음에 물을 질문: 질문 따라 찾기와 같은 순서 → 남으면 드문 사항(보훈·다문화 등)을 하나씩 */
export function easyNext(st: FlowStep, s: Situation, asked: readonly FlowQuestionId[]): FlowQuestionId | null {
  const q = nextQuestion(st, s, asked)?.id;
  if (q) return q;
  return rarePicks(s).map((r) => r.key).find((k) => !asked.includes(k)) ?? null;
}

