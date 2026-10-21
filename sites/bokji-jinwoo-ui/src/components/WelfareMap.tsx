import { Icon, type IconName } from "./Icon";
import { CompassNeedle } from "./CompassNeedle";
import styles from "./WelfareMap.module.css";

const MARKS: { name: IconName; label: string; kind: string }[] = [
  { name: "home", label: "주거", kind: "housing" },
  { name: "briefcase", label: "일자리", kind: "work" },
  { name: "graduation", label: "교육", kind: "learning" },
  { name: "heart", label: "의료", kind: "health" },
  { name: "baby", label: "돌봄", kind: "care" },
];

/** 실제 위치·수급 판정이 아닌 장식 지도. 커서 반응은 바늘에만 적용한다. */
export function WelfareMap() {
  return (
    <div className={styles.scene} aria-hidden="true" data-testid="welfare-map">
      <div className={styles.map}>
        <svg viewBox="0 0 640 600" fill="none" focusable="false">
          <rect width="640" height="600" fill="#e8ecdf" />
          <g fill="#d9e1ce">
            <path d="M-20 20 183 0 153 157 22 177Z" />
            <path d="m222 4 170-24 45 154-115 50-116-57Z" />
            <path d="m497-12 173 8-12 211-136-23-54-85Z" />
            <path d="m-14 268 139-58 83 100-49 107L-5 397Z" />
            <path d="m476 263 179-17 11 163-159 28-58-98Z" />
            <path d="m-15 454 177-8 45 177-224 7Z" />
            <path d="m416 478 245-32 8 165-227 20Z" />
          </g>
          <path d="M340-40C282 88 492 167 380 302S185 479 304 652" stroke="#bdcfcb" strokeWidth="54" />
          <g stroke="#f8f8f0" strokeWidth="15" strokeLinecap="round" strokeLinejoin="round">
            <path d="M-30 212 220 155 480 205 665 145" />
            <path d="m185-30-35 185 70 199-35 278" />
            <path d="M-30 441 217 395 448 447 670 407" />
            <path d="m445-20 25 225-42 176 45 254" />
            <path d="m-20 303 167-35M20 99l147-33m50 424 188 29m80-220 169 38" strokeWidth="7" />
          </g>
          <g fill="#f2f3e9" stroke="#d5ddca" strokeWidth="1.5">
            <rect x="42" y="38" width="58" height="39" rx="7" transform="rotate(-12 42 38)" />
            <rect x="44" y="111" width="76" height="40" rx="7" transform="rotate(-12 44 111)" />
            <rect x="251" y="48" width="49" height="63" rx="7" transform="rotate(16 251 48)" />
            <rect x="519" y="53" width="86" height="54" rx="8" transform="rotate(-12 519 53)" />
            <rect x="37" y="332" width="70" height="44" rx="7" transform="rotate(-14 37 332)" />
            <rect x="523" y="348" width="80" height="44" rx="7" transform="rotate(-8 523 348)" />
            <rect x="38" y="485" width="62" height="63" rx="8" transform="rotate(-9 38 485)" />
            <rect x="509" y="500" width="77" height="52" rx="8" transform="rotate(-8 509 500)" />
          </g>
          <g fill="#bcccae">
            <circle cx="76" cy="238" r="13" /><circle cx="102" cy="230" r="10" />
            <circle cx="570" cy="227" r="17" /><circle cx="595" cy="218" r="12" />
            <circle cx="372" cy="557" r="14" /><circle cx="396" cy="549" r="11" />
          </g>
        </svg>
      </div>
      <div className={styles.orbit} />
      {MARKS.map((mark) => (
        <div key={mark.kind} className={`${styles.pin} ${styles[mark.kind]}`}>
          <div className={styles.pinBody}><Icon name={mark.name} size={30} strokeWidth={1.65} /></div>
          <span>{mark.label}</span>
        </div>
      ))}
      <div className={styles.compass}>
        <svg viewBox="0 0 180 180" focusable="false">
          <circle cx="90" cy="90" r="87" fill="#fcfcf5" stroke="#d2d9c6" strokeWidth="2" />
          <circle cx="90" cy="90" r="70" fill="#eaf0dd" stroke="#d9e2ca" />
          {Array.from({ length: 36 }, (_, i) => (
            <path key={i} d={`M90 12v${i % 3 === 0 ? 9 : 4}`} transform={`rotate(${i * 10} 90 90)`} stroke="#718365" strokeWidth={i % 3 === 0 ? 1.5 : 1} />
          ))}
          <text x="90" y="42" textAnchor="middle" fill="#4c6043" fontSize="12" fontFamily="sans-serif">N</text>
          <path d="M90 53v74M53 90h74" stroke="#ccd7bc" />
          <CompassNeedle />
          <circle cx="90" cy="90" r="7" fill="#fcfcf5" stroke="#294c37" strokeWidth="3" />
        </svg>
      </div>
      <span className={styles.spark}>✦</span>
    </div>
  );
}
