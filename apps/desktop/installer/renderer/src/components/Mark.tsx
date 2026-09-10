// アプリの意匠を SVG で描いたもの。
//
// **`scripts/make-icon.py` と同じ図形**（同じ比率・同じ色）で、
// あちらは ICO / PNG を、こちらは画面を描く。ずれるとロゴが 2 種類になるので、
// 座標は `make-icon.py` の比率を 64 倍したものをそのまま書いてある。
//
//   本体   0.235–0.765 x 0.272–0.890, r=0.085
//   端子   0.370–0.630 x 0.110–0.300
//   矢印   0.455–0.545 の軸 + 0.375/0.625/0.500 の三角
//
// **Ubuntu の意匠（オレンジの円環・ワードマーク）は使わない**（Canonical の商標）。

interface Props {
  readonly size?: number
  /** 光をゆっくり明滅させる。表題まわりだけで使う。 */
  readonly glow?: boolean
  /** 矢印をゆっくり落とす（＝書き込む向き）。 */
  readonly animateArrow?: boolean
}

export function Mark({ size = 56, glow = false, animateArrow = false }: Props): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={glow ? 'mark-glow' : undefined}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="mark-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#0f172a" />
          <stop offset="100%" stopColor="#4338ca" />
        </linearGradient>
      </defs>

      <rect x="0" y="0" width="64" height="64" rx="14.1" fill="url(#mark-bg)" />

      {/* 端子（金属色を少しだけ落とす） */}
      <rect x="23.7" y="7" width="16.6" height="12.2" fill="#cbd5e1" />
      <rect x="26.8" y="9.3" width="10.5" height="2.6" fill="#475569" />
      <rect x="26.8" y="13.6" width="10.5" height="2.6" fill="#475569" />

      {/* 本体 */}
      <rect x="15" y="17.4" width="34" height="39.6" rx="5.4" fill="#ffffff" />

      {/* 下向きの矢印を背景色で抜く（＝書き込む） */}
      <g className={animateArrow ? 'mark-arrow' : undefined}>
        <rect x="29.1" y="24" width="5.8" height="15" fill="#1e293b" />
        <path d="M24 36.8 L40 36.8 L32 49.6 Z" fill="#1e293b" />
      </g>
    </svg>
  )
}
