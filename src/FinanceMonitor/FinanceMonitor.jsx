import { useEffect, useRef, useState } from 'react'
import GlobeWidget from './GlobeWidget'
import IndexPanel from './IndexPanel'
import { runFinanceFetch } from './financeRunner'
import { runIndexFetch } from './indexRunner'
import './FinanceMonitor.css'

/**
 * 【页面】XIKO Finance Monitor（独立部署版）
 *
 * 整页为一个大的圆角磨砂矩形，用灰色稍淡的实线在正中分为左右两块区域：
 *   左侧：三维地球 —— 卫星 / 极简地图切换，随太阳直射经度缓慢自转，
 *         全球主要指数的圆形行情图标贴合球面悬浮；
 *   右侧：A 股指数区 —— 上为沪市/科创板（沪、科），下为深市/创业板（深、创），
 *         指数以长条翻转卡片呈现（悬停翻面显示代码与涨跌幅）：
 *         排序码按涨跌幅从高到低排列，附加码以普通卡片排在其后（轮播格保留备用）。
 *
 * 数据链路：每 3 秒由前端直接请求腾讯行情接口（qt.gtimg.cn）并内嵌解析：
 * 全球指数（含交易时段判断，见 financeRunner.js）刷新地球，
 * A 股指数四项信息（见 indexRunner.js）刷新右侧指数区；不依赖任何后端 / xlsx / .py 文件。
 */

/* 右侧指数区代码配置：每个半区为 3 列卡片网格，行数自适应（沪 15 个 / 5 行，深 16 个 / 6 行）。
   排序码按涨跌幅从高到低排列；附加码不参与排序，作为普通卡片排在排序卡片之后。
   轮播格（RotatingSlot）在 IndexPanel 中保留备用，当前未启用。 */
const SH_SORTED_CODES = [
  'sh000032', 'sh000033', 'sh000034', 'sh000035', 'sh000036',
  'sh000037', 'sh000038', 'sh000039', 'sh000040', 'sh000041',
]
const SH_EXTRA_CODES = ['sh000688', 'sh000698', 'sh000699', 'sh000680', 'sh000690']
const SZ_SORTED_CODES = [
  'sz399613', 'sz399614', 'sz399615', 'sz399616', 'sz399617', 'sz399618',
  'sz399619', 'sz399620', 'sz399621', 'sz399622', 'sz399637',
]
const SZ_EXTRA_CODES = ['sz399006', 'sz399673', 'sz399019', 'sz399102', 'sz399296']
const ALL_INDEX_CODES = [
  ...SH_SORTED_CODES, ...SH_EXTRA_CODES, ...SZ_SORTED_CODES, ...SZ_EXTRA_CODES,
]

export default function FinanceMonitor() {
  const [quotes, setQuotes] = useState(null) /* { code: getroughdata 七项结果 } */
  const [trade, setTrade] = useState(null)   /* { code: { start, end } } 北京时间交易时段 */
  const [indices, setIndices] = useState({}) /* { code: getindexdata 四项结果 } 右侧 A 股指数区 */
  const [error, setError] = useState('')
  const busyRef = useRef(false)

  /* 每 3 秒轮询一次：刷新全球指数与 A 股指数行情（上一轮未完成则跳过） */
  useEffect(() => {
    let alive = true
    const pull = async () => {
      if (busyRef.current) return
      busyRef.current = true
      try {
        /* 全球指数行情（三维地球） */
        try {
          const data = await runFinanceFetch()
          if (!alive) return
          setQuotes(data.quotes || {})
          setTrade(data.trade || {})
          setError('')
        } catch (err) {
          if (alive) setError(err && err.message ? err.message : String(err))
        }
        /* A 股指数行情（右侧沪/科、深/创区）；失败不影响地球 */
        try {
          const data = await runIndexFetch(ALL_INDEX_CODES)
          if (!alive) return
          setIndices(data.indices || {})
        } catch (err) {
          console.warn('[FinanceMonitor] 指数行情获取失败:', err)
        }
      } finally {
        busyRef.current = false
      }
    }
    pull()
    const timer = setInterval(pull, 3000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [])

  return (
    <div className="fm-page">
      <header className="fm-page__header">
        <h1 className="fm-page__title">XIKO Finance Monitor</h1>
        <p className="fm-page__subtitle">三维全球行情地球 · 沪深指数实时看板 · 每 3 秒自动刷新</p>
      </header>

      <div className="fm-panel">
        {/* 左侧：三维地球 */}
        <div className="fm-panel__left">
          <GlobeWidget quotes={quotes} trade={trade} error={error} />
        </div>

        {/* 正中分割线（灰色稍淡实线） */}
        <div className="fm-panel__divider" aria-hidden="true" />

        {/* 右侧：A 股指数区（上 = 沪市/科创板，下 = 深市/创业板） */}
        <div className="fm-panel__right">
          <IndexPanel
            tags={['沪', '科']}
            sortedCodes={SH_SORTED_CODES}
            extraCodes={SH_EXTRA_CODES}
            indices={indices}
          />
          <div className="fm-panel__divider-h" aria-hidden="true" />
          <IndexPanel
            tags={['深', '创']}
            sortedCodes={SZ_SORTED_CODES}
            extraCodes={SZ_EXTRA_CODES}
            indices={indices}
          />
        </div>
      </div>

      {error && !quotes ? <div className="fm-error">行情数据加载失败：{error}</div> : null}

      <footer className="fm-page__footer">
        数据来源：
        <a
          className="fm-status__link"
          href="https://stockapp.finance.qq.com/"
          target="_blank"
          rel="noreferrer"
        >
          腾讯证券
        </a>
        · 仅供学习交流 · 不构成任何投资建议
      </footer>
    </div>
  )
}
