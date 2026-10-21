/** 홈 머리 띠 그림 (직접 그린 단순 도형: 안내서 한 장 + 하트 나침반 상징 + 집) */
export function HeroArt() {
  return (
    <svg className="hero-art" viewBox="0 0 360 300" aria-hidden="true" focusable="false">
      <circle cx="250" cy="120" r="110" fill="#d8e5fd" opacity=".55" />
      <circle cx="90" cy="230" r="60" fill="#dbe6f2" opacity=".7" />
      {/* 안내서 */}
      <g transform="rotate(-4 170 150)">
        <rect x="95" y="50" width="170" height="210" rx="16" fill="#fff" stroke="#b1cefb" strokeWidth="2" />
        <rect x="117" y="76" width="80" height="10" rx="5" fill="#256ef4" />
        <rect x="117" y="96" width="120" height="7" rx="3.5" fill="#d8e5fd" />
        {[130, 168, 206].map((y, i) => (
          <g key={y}>
            <rect x="117" y={y} width="20" height="20" rx="6" fill={i < 2 ? "#256ef4" : "#fff"} stroke="#256ef4" strokeWidth="2" />
            {i < 2 && <path d={`M122 ${y + 10.5}l4 4 7-8`} fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />}
            <rect x="147" y={y + 2} width={i === 1 ? 70 : 92} height="7" rx="3.5" fill="#cdd1d5" />
            <rect x="147" y={y + 13} width={i === 1 ? 50 : 64} height="5" rx="2.5" fill="#e3e6ea" />
          </g>
        ))}
      </g>
      {/* 하트 나침반 (복지나침반 상징 — /brand/logo-symbol.svg) */}
      <g transform="translate(272 214)">
        <circle r="40" fill="#fff" stroke="#d8e5fd" strokeWidth="3" />
        <image href="/brand/logo-symbol.svg" x="-27" y="-23" width="54" height="49.4" />
      </g>
      {/* 집 */}
      <g transform="translate(52 150)" fill="none" stroke="#346fb2" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round">
        <path d="M0 26 26 4l26 22" />
        <path d="M8 20v28h36V20" fill="#fff" />
        <path d="M21 48V34h10v14" />
      </g>
      <circle cx="318" cy="70" r="6" fill="#ffb114" />
      <circle cx="60" cy="96" r="4" fill="#256ef4" opacity=".5" />
    </svg>
  );
}
