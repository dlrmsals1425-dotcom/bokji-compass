import Link from "next/link";
import { Icon } from "@/components/Icon";
import { ResumeBanner } from "@/components/ResumeBanner";
import { PresetButtons } from "@/components/PresetButtons";
import { WelfareMap } from "@/components/WelfareMap";
import { LocationPreload } from "@/components/LocationPreload";
import { METHOD_ENTRY } from "@/lib/client/mode";
import styles from "./page.module.css";

export default function Home() {
  return (
    <div className={styles.home}>
      <LocationPreload />
      <section className={styles.start} aria-labelledby="hero-h">
        <div className={styles.intro}>
          <h1 id="hero-h">내게 맞는 복지,<br /><span>여기서 찾으세요.</span></h1>
          <div className={styles.methods} role="group" aria-label="찾는 방법 고르기">
          {(["guided", "talk"] as const).map((key) => {
            const method = METHOD_ENTRY[key];
            return (
              <Link key={key} href={method.href} className={`${styles.method} ${key === "guided" ? styles.featured : ""}`} data-testid={method.testId}>
                <span>{method.title}</span>
                <Icon name={key === "guided" ? "arrowRight" : "mic"} size={22} />
              </Link>
            );
          })}
          </div>
          {/* (2026-10-21 인터뷰) 부모님이 직접 쓰기 쉬운 길 — 예/아니요로만 */}
          <Link href="/easy" className={styles.easy} data-testid="start-easy">
            <span>
              <b>쉬운 찾기</b> · 예/아니요로만 답해요
            </span>
            <Icon name="arrowRight" size={20} />
          </Link>
          <div className={styles.resume}><ResumeBanner /></div>
        </div>
        <WelfareMap />
      </section>
      <div className={styles.examples}>
        <details className={styles.more}>
          <summary>가상 예시 보기 <Icon name="chevronDown" size={18} /></summary>
          <PresetButtons />
        </details>
      </div>
    </div>
  );
}
