/**
 * 위기 문장 안내 (QA 1차 M4): 자살·자해 생각이 보이면 자살예방상담전화 109를 맨 먼저,
 * 생계가 막막하다는 문장이면 보건복지상담센터 129와 긴급복지지원을 맨 위에 보여 준다.
 */
import Link from "@/components/SiteLink";
import { Icon } from "@/components/Icon";
import { crisisOf } from "@/lib/client/query";

export function CrisisHelp({ text }: { text: string }) {
  const kind = crisisOf(text);
  if (!kind) return null;
  return (
    <aside className="crisis-help" role="alert" aria-labelledby="crisis-h" data-testid="crisis-help" data-kind={kind}>
      <h2 id="crisis-h" className="crisis-h">
        <Icon name="phone" size={20} /> {kind === "suicide" ? "혼자 견디지 않으셔도 돼요" : "지금 바로 도움을 받을 수 있어요"}
      </h2>
      <ul className="crisis-list">
        {kind === "suicide" && (
          <li>
            <a href="tel:109" className="crisis-tel" data-testid="crisis-109">
              자살예방상담전화 <strong>109</strong>
            </a>{" "}
            <span className="small">24시간 · 무료 · 문자·카카오톡 상담도 있어요</span>
          </li>
        )}
        <li>
          <a href="tel:129" className="crisis-tel" data-testid="crisis-129">
            보건복지상담센터 <strong>129</strong>
          </a>{" "}
          <span className="small">생계·의료·주거 위기 상담 (평일 9~18시, 긴급 상황은 24시간)</span>
        </li>
        {kind === "suicide" && (
          <li>
            <a href="tel:1577-0199" className="crisis-tel">
              정신건강위기상담 <strong>1577-0199</strong>
            </a>{" "}
            <span className="small">24시간</span>
          </li>
        )}
        <li>
          갑자기 생계가 어려워졌다면 <Link href="/search?q=%EA%B8%B4%EA%B8%89%EB%B3%B5%EC%A7%80">긴급복지지원</Link>을 주민센터나 129에 바로 요청할 수 있어요.
        </li>
      </ul>
      <p className="small muted">위험이 급하면 112·119에 바로 전화하세요.</p>
    </aside>
  );
}
