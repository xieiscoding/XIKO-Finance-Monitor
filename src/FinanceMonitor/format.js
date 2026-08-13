/* ===== Numeric formatting and rise/fall color scheme (shared between globe and right-side index cards) =====
   Red for up, green for down; the larger the magnitude, the deeper the color. */

export const fmtValue = (v) =>
  v == null ? '--' : Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export const fmtPct = (v) => (v == null ? '--' : (v > 0 ? '+' : '') + Number(v).toFixed(2) + '%')

export function changeColor(pct) {
  if (pct == null || !Number.isFinite(pct)) return 'rgb(214,218,226)'
  const t = Math.min(Math.abs(pct) / 3, 1)
  const target = pct >= 0 ? [255, 64, 54] : [38, 199, 110]
  const base = [214, 218, 226]
  const c = base.map((b, i) => Math.round(b + (target[i] - b) * t))
  return 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')'
}