import { useEffect, useMemo, useRef, useState } from 'react'
import { changeColor, fmtPct, fmtValue } from './format'

/**
 * 【部件】右侧 A 股指数区（沪/科 与 深/创 两个半区）
 *
 * IndexCard —— 长条圆角矩形卡片，灰色虚线分为左右两部分：
 *   正面：左 = 指数简称，右 = 指数数值；
 *   鼠标悬停绕水平横轴翻转 180° 到背面：左 = 指数代码，右 = 涨跌幅(%)；
 *   指数数值与涨跌幅均按"红涨绿跌、幅值越大越深"配色（与地球图标一致）。
 *
 * RotatingSlot —— 轮播卡槽：每隔 15s 换下一条 code 的内容，
 *   切换时原始数据淡出、新数据淡入。保留备用的组件：当前布局未启用，
 *   需要时给 IndexPanel 传 rotatingSlots（code 数组的数组）即可恢复轮播格。
 *
 * IndexPanel —— 半区：左上角市场标签（如"沪""科"）+ 3 列卡片网格（行数自适应）；
 *   sortedCodes 按涨跌幅从高到低排序，
 *   extraCodes 不参与排序，作为普通卡片排在排序卡片之后。
 */

/* ===== 翻转卡片 ===== */
function IndexCard({ code, data }) {
  const pct = data ? data['涨跌幅(%)'] : null
  const color = changeColor(pct)
  return (
    <div className="fm-card" data-code={code}>
      <div className="fm-card__inner">
        <div className="fm-card__face fm-card__face--front">
          <span className="fm-card__half fm-card__name">{(data && data['指数简称']) || '--'}</span>
          <span className="fm-card__half fm-card__half--right fm-card__num" style={{ color }}>
            {data ? fmtValue(data['指数数值']) : '--'}
          </span>
        </div>
        <div className="fm-card__face fm-card__face--back">
          <span className="fm-card__half fm-card__code">{(data && data['指数代码']) || '--'}</span>
          <span className="fm-card__half fm-card__half--right fm-card__num" style={{ color }}>
            {data ? fmtPct(pct) : '--'}
          </span>
        </div>
      </div>
    </div>
  )
}

/* ===== 轮播卡槽（15s 切换，淡出 + 淡入）——保留备用，当前布局未启用 ===== */
const ROTATE_MS = 15000
const FADE_MS = 320

function RotatingSlot({ codes, indices }) {
  const [step, setStep] = useState(0)
  const [fading, setFading] = useState(false)
  const swapRef = useRef(0)
  useEffect(() => {
    const timer = setInterval(() => {
      setFading(true) /* 先淡出当前数据 */
      clearTimeout(swapRef.current)
      swapRef.current = setTimeout(() => {
        setStep((s) => s + 1) /* 换到下一条 code */
        setFading(false)      /* 再淡入新数据 */
      }, FADE_MS)
    }, ROTATE_MS)
    return () => {
      clearInterval(timer)
      clearTimeout(swapRef.current)
    }
  }, [])
  const code = codes[step % codes.length]
  return (
    <div className={'fm-card-slot' + (fading ? ' fm-card-slot--fading' : '')}>
      <IndexCard code={code} data={indices[code]} />
    </div>
  )
}

/* ===== 半区（标签 + 3 列网格，行数随卡片数量自适应） ===== */
export default function IndexPanel({ tags, sortedCodes, extraCodes = [], rotatingSlots = [], indices = {} }) {
  /* 涨跌幅从高到低排序；尚未取到数据的排在最后（稳定排序，保持原列表顺序） */
  const sorted = useMemo(() => {
    const pctOf = (c) => {
      const d = indices[c]
      const p = d ? d['涨跌幅(%)'] : null
      return Number.isFinite(p) ? p : -Infinity
    }
    return [...sortedCodes].sort((a, b) => pctOf(b) - pctOf(a))
  }, [indices, sortedCodes])

  const cells = []
  for (const code of sorted) {
    cells.push(<IndexCard key={code} code={code} data={indices[code]} />)
  }
  /* 附加 code：不参与排序，作为普通卡片排在排序卡片之后 */
  for (const code of extraCodes) {
    cells.push(<IndexCard key={'x-' + code} code={code} data={indices[code]} />)
  }
  /* 轮播格（保留备用）：传入 code 数组的数组即可恢复之前的轮播展示 */
  rotatingSlots.forEach((codes, i) => {
    cells.push(<RotatingSlot key={'rot' + i} codes={codes} indices={indices} />)
  })

  return (
    <div className="fm-index-half">
      <div className="fm-index-half__tags">
        {tags.map((t) => (
          <span key={t} className="fm-index-half__tag">{t}</span>
        ))}
      </div>
      <div className="fm-index-half__grid">{cells}</div>
    </div>
  )
}