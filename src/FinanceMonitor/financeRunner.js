/* ===== Finance Monitor data runner (frontend-embedded implementation) =====
   No longer depends on any xlsx / .py files: the data tables and parsing logic of the original
   financemonitor_v1/Global/getroughdata.py are embedded directly into the frontend. The browser
   requests the Tencent quote API (qt.gtimg.cn, Access-Control-Allow-Origin: *) and parses itself:
   1. The quote URL is uniformly https://qt.gtimg.cn/q=<code>; the response is GBK text,
      decoded with TextDecoder('gbk');
   2. Embedded tables: trading hours table (originally tradetime.xlsx), code basic-info table and
      timezone table (originally inside the .py);
   3. Field-by-field parsing per market format (A-share / HK / FTSE family / gz international / US);
      update times are uniformly converted to Beijing time (UTC+8, DST-aware for European indices);
   4. Returns { quotes, trade, errors } — identical shape to the previous implementation, so the
      globe component needs no changes. */

/* Quote URL: always https (plain http would be blocked on https pages) */
const quoteUrl = (code) => 'https://qt.gtimg.cn/q=' + code

/* Trading hours table (Beijing time), embedded from the original financemonitor_v1/Global/tradetime.xlsx */
const TRADE_TIMES = {
  sh000001: { start: '09:30:00', end: '15:00:00' },
  sz399001: { start: '09:30:00', end: '15:00:00' },
  hkHSI: { start: '09:30:00', end: '16:00:00' },
  ftXIN9: { start: '09:00:00', end: '16:30:00' },
  ftFBMKLCI: { start: '09:00:00', end: '17:00:00' },
  gzN225: { start: '08:00:00', end: '14:00:00' },
  gzKS11: { start: '08:00:00', end: '14:30:00' },
  gzTWII: { start: '09:00:00', end: '13:30:00' },
  gzFTSTI: { start: '09:00:00', end: '17:00:00' },
  gzENSEX: { start: '11:45:00', end: '18:00:00' },
  gzGSPTSE: { start: '21:30:00', end: '04:00:00' },
  gzMXX: { start: '23:30:00', end: '05:00:00' },
  gzFCHI: { start: '15:00:00', end: '23:30:00' },
  gzIBEX: { start: '15:00:00', end: '23:30:00' },
  gzAEX: { start: '15:00:00', end: '23:30:00' },
  gzPSI20: { start: '15:00:00', end: '23:30:00' },
  gzS51: { start: '08:00:00', end: '14:00:00' },
  ukUKX: { start: '15:00:00', end: '23:30:00' },
  ftDAX30: { start: '15:00:00', end: '23:30:00' },
  ftE3X: { start: '15:00:00', end: '23:30:00' },
  ftFTSEMIB: { start: '15:00:00', end: '23:30:00' },
  s_usDJI: { start: '21:30:00', end: '04:00:00' },
  s_usIXIC: { start: '21:30:00', end: '04:00:00' },
  s_usINX: { start: '21:30:00', end: '04:00:00' },
}

/* Timezone each code's returned update-time belongs to (IANA name).
   Most indices already return Beijing time; FTSE European indices return local exchange time
   and are converted to Beijing time (DST-aware). */
const TIMEZONE_MAP = {
  sh000001: 'Asia/Shanghai',
  sz399001: 'Asia/Shanghai',
  hkHSI: 'Asia/Hong_Kong',
  ftXIN9: 'Asia/Singapore',
  ftFBMKLCI: 'Asia/Kuala_Lumpur',
  gzN225: 'Asia/Shanghai',
  gzKS11: 'Asia/Shanghai',
  gzTWII: 'Asia/Shanghai',
  gzFTSTI: 'Asia/Shanghai',
  gzENSEX: 'Asia/Shanghai',
  gzGSPTSE: 'Asia/Shanghai',
  gzMXX: 'Asia/Shanghai',
  gzFCHI: 'Asia/Shanghai',
  gzIBEX: 'Asia/Shanghai',
  gzAEX: 'Asia/Shanghai',
  gzPSI20: 'Asia/Shanghai',
  gzS51: 'Asia/Shanghai',
  ukUKX: 'Europe/London',
  ftDAX30: 'Europe/Berlin',
  ftE3X: 'Europe/Paris',
  ftFTSEMIB: 'Europe/Rome',
}

/* Static info table: some formats (A-share / gz / US) do not return English names or region,
   so keep an offline code -> meta table to complete the result (same as the .py). */
const INDEX_META = {
  sh000001: { '中文名称': '上证指数', '英文全称': 'SSE Composite Index', '英文简称': 'SHCOMP', '国家-省份': '中国-上海' },
  sz399001: { '中文名称': '深证成指', '英文全称': 'SZSE Component Index', '英文简称': 'SZCOMP', '国家-省份': '中国-深圳' },
  hkHSI: { '中文名称': '恒生指数', '英文全称': 'Hang Seng Index', '英文简称': 'HSI', '国家-省份': '中国-香港' },
  ftXIN9: { '中文名称': '富时中国A50指数', '英文全称': 'FTSE China A50 Index', '英文简称': 'XIN9', '国家-省份': '中国' },
  ftFBMKLCI: { '中文名称': '富时马来西亚KLCI', '英文全称': 'FTSE Bursa Malaysia KLCI', '英文简称': 'FBMKLCI', '国家-省份': '马来西亚' },
  ukUKX: { '中文名称': '富时100', '英文全称': 'FTSE 100 Index', '英文简称': 'UKX', '国家-省份': '英国' },
  ftDAX30: { '中文名称': '德国DAX30', '英文全称': 'DAX30 Index', '英文简称': 'DAX30', '国家-省份': '德国' },
  ftE3X: { '中文名称': '富时Eurofirst 300', '英文全称': 'FTSE Eurofirst 300 Index', '英文简称': 'E3X', '国家-省份': '欧洲' },
  ftFTSEMIB: { '中文名称': '富时意大利MIB', '英文全称': 'FTSE MIB Index', '英文简称': 'FTSEMIB', '国家-省份': '意大利' },
  gzN225: { '中文名称': '日经225指数', '英文全称': 'Nikkei 225', '英文简称': 'N225', '国家-省份': '日本' },
  gzKS11: { '中文名称': '韩国首尔综合', '英文全称': 'KOSPI Composite Index', '英文简称': 'KS11', '国家-省份': '韩国' },
  gzTWII: { '中文名称': '台湾加权指数', '英文全称': 'Taiwan Weighted Stock Index (TAIEX)', '英文简称': 'TWII', '国家-省份': '中国-台湾' },
  gzFTSTI: { '中文名称': '富时新加坡海峡时报指数', '英文全称': 'Straits Times Index', '英文简称': 'FTSTI', '国家-省份': '新加坡' },
  gzENSEX: { '中文名称': '印度孟买SENSEX指数', '英文全称': 'S&P BSE SENSEX', '英文简称': 'ENSEX', '国家-省份': '印度' },
  gzGSPTSE: { '中文名称': '加拿大S&P/TSX综合指数', '英文全称': 'S&P/TSX Composite Index', '英文简称': 'GSPTSE', '国家-省份': '加拿大' },
  gzMXX: { '中文名称': '墨西哥BOLSA指数', '英文全称': 'IPC (BOLSA) Index', '英文简称': 'MXX', '国家-省份': '墨西哥' },
  gzFCHI: { '中文名称': '法国CAC40指数', '英文全称': 'CAC 40', '英文简称': 'FCHI', '国家-省份': '法国' },
  gzIBEX: { '中文名称': '西班牙IBEX 35指数', '英文全称': 'IBEX 35', '英文简称': 'IBEX', '国家-省份': '西班牙' },
  gzAEX: { '中文名称': '荷兰AEX综合指数', '英文全称': 'AEX Index', '英文简称': 'AEX', '国家-省份': '荷兰' },
  gzPSI20: { '中文名称': '葡萄牙PSI 20指数', '英文全称': 'PSI 20', '英文简称': 'PSI20', '国家-省份': '葡萄牙' },
  gzS51: { '中文名称': '澳大利亚标准普尔200指数', '英文全称': 'S&P/ASX 200', '英文简称': 'S51', '国家-省份': '澳大利亚' },
  s_usDJI: { '中文名称': '道琼斯', '英文全称': 'Dow Jones Industrial Average', '英文简称': 'DJI', '国家-省份': '美国' },
  s_usIXIC: { '中文名称': '纳斯达克', '英文全称': 'NASDAQ Composite', '英文简称': 'IXIC', '国家-省份': '美国' },
  s_usINX: { '中文名称': '标普500', '英文全称': 'S&P 500', '英文简称': 'INX', '国家-省份': '美国' },
}

/* ===== Basic helpers ===== */
const getField = (fields, i) => (i < fields.length ? fields[i] : '')

const toFloat = (text) => {
  const t = String(text == null ? '' : text).trim()
  if (!t) return null
  const v = Number(t)
  return Number.isFinite(v) ? v : null
}

const metaOf = (code) => INDEX_META[code] || {}
const tzOf = (code) => TIMEZONE_MAP[code] || 'Asia/Shanghai'

/* ===== Time conversion: interpret "local wall-clock time" in its IANA zone, convert to Beijing ===== */
const dtfCache = new Map()
function getDtf(timeZone) {
  let dtf = dtfCache.get(timeZone)
  if (!dtf) {
    dtf = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    dtfCache.set(timeZone, dtf)
  }
  return dtf
}

/* UTC offset (ms) of the zone at the given instant (DST handled automatically) */
function tzOffsetMs(ms, timeZone) {
  const parts = {}
  for (const p of getDtf(timeZone).formatToParts(new Date(ms))) parts[p.type] = p.value
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second)
  return asUtc - ms
}

/* Wall-clock time (no zone) -> UTC ms; second pass guards against DST-transition edges */
function wallToMs(y, mo, d, h, mi, s, timeZone) {
  const utcGuess = Date.UTC(y, mo - 1, d, h, mi, s)
  let ms = utcGuess - tzOffsetMs(utcGuess, timeZone)
  ms = utcGuess - tzOffsetMs(ms, timeZone)
  return ms
}

/* Format an instant as Beijing time YYYY-MM-DD HH:MM:SS */
function formatBeijing(ms) {
  const p = {}
  for (const x of getDtf('Asia/Shanghai').formatToParts(new Date(ms))) p[x.type] = x.value
  return p.year + '-' + p.month + '-' + p.day + ' ' + p.hour + ':' + p.minute + ':' + p.second
}

/* Parse the three time formats the API returns -> { y, mo, d, h, mi, s } or null */
function parseDatetime(text) {
  let m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(text)
  if (!m) m = /^(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(text)
  if (!m) m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(text)
  if (!m) return null
  return { y: +m[1], mo: +m[2], d: +m[3], h: +m[4], mi: +m[5], s: +m[6] }
}

/* Convert a returned time string to Beijing time; empty -> null; unknown format -> unchanged */
function toBeijingTime(text, tzName) {
  const t = String(text == null ? '' : text).trim()
  if (!t) return null
  const dt = parseDatetime(t)
  if (!dt) return t
  return formatBeijing(wallToMs(dt.y, dt.mo, dt.d, dt.h, dt.mi, dt.s, tzName))
}

/* ===== Per-market parsers (field indexes identical to the .py) ===== */
function buildResult(code, nameCn, enFull, enShort, region, updateTime, value, changePct) {
  return {
    code,
    '中文名称': nameCn,
    '英文全称': enFull,
    '英文简称': enShort,
    '国家-省份': region,
    '更新时间': updateTime,
    '指数数值': value,
    '涨跌幅(%)': changePct,
  }
}

/* A-share (sh/sz, ~88 fields): [1] name [3] value [30] time [32] pct */
function parseAShare(code, fields) {
  const meta = metaOf(code)
  return buildResult(
    code,
    getField(fields, 1) || meta['中文名称'],
    meta['英文全称'],
    meta['英文简称'],
    meta['国家-省份'],
    toBeijingTime(getField(fields, 30), tzOf(code)),
    toFloat(getField(fields, 3)),
    toFloat(getField(fields, 32)),
  )
}

/* HK (hk, ~78 fields): [1] name [2] en-short [3] value [30] time [32] pct [46] en-full */
function parseHk(code, fields) {
  const meta = metaOf(code)
  return buildResult(
    code,
    getField(fields, 1) || meta['中文名称'],
    getField(fields, 46) || meta['英文全称'],
    getField(fields, 2) || meta['英文简称'],
    meta['国家-省份'],
    toBeijingTime(getField(fields, 30), tzOf(code)),
    toFloat(getField(fields, 3)),
    toFloat(getField(fields, 32)),
  )
}

/* FTSE family (ft/uk, ~71 fields): same key indexes as HK */
function parseFt(code, fields) {
  const meta = metaOf(code)
  return buildResult(
    code,
    getField(fields, 1) || meta['中文名称'],
    getField(fields, 46) || meta['英文全称'],
    getField(fields, 2) || meta['英文简称'],
    meta['国家-省份'],
    toBeijingTime(getField(fields, 30), tzOf(code)),
    toFloat(getField(fields, 3)),
    toFloat(getField(fields, 32)),
  )
}

/* gz international (~8 fields): [0] en-short [1] name [2] time [3] value [5] pct */
function parseGz(code, fields) {
  const meta = metaOf(code)
  return buildResult(
    code,
    getField(fields, 1) || meta['中文名称'],
    meta['英文全称'],
    getField(fields, 0) || meta['英文简称'],
    meta['国家-省份'],
    toBeijingTime(getField(fields, 2), tzOf(code)),
    toFloat(getField(fields, 3)),
    toFloat(getField(fields, 5)),
  )
}

/* US (s_us, 10 fields): [1] name [2] en-short (leading dot) [3] value [5] pct; no time field */
function parseUs(code, fields) {
  const meta = metaOf(code)
  const short = (getField(fields, 2) || meta['英文简称'] || '').replace(/^\.+/, '')
  return buildResult(
    code,
    getField(fields, 1) || meta['中文名称'],
    meta['英文全称'],
    short,
    meta['国家-省份'],
    null,
    toFloat(getField(fields, 3)),
    toFloat(getField(fields, 5)),
  )
}

function parseResponse(code, text) {
  const m = /"([^"]*)"/.exec(text)
  if (!m) throw new Error('返回内容中未找到引号包裹的数据: ' + text.slice(0, 120))
  const fields = m[1].split('~')
  if (code.startsWith('sh') || code.startsWith('sz')) return parseAShare(code, fields)
  if (code.startsWith('hk')) return parseHk(code, fields)
  if (code.startsWith('ft') || code.startsWith('uk')) return parseFt(code, fields)
  if (code.startsWith('s_us')) return parseUs(code, fields)
  if (code.startsWith('gz')) return parseGz(code, fields)
  throw new Error('无法识别的 code 前缀: ' + code)
}

/* ===== Fetch & decode ===== */
async function fetchQuoteText(code) {
  const resp = await fetch(quoteUrl(code))
  if (!resp.ok) throw new Error('行情接口请求失败（HTTP ' + resp.status + '）: ' + code)
  const buf = await resp.arrayBuffer()
  let decoder
  try {
    decoder = new TextDecoder('gbk') /* API returns GBK; Chinese names would garble otherwise */
  } catch {
    decoder = new TextDecoder('utf-8')
  }
  return decoder.decode(buf)
}

/* Run one fetch: returns { quotes: {code: 7-item info}, trade: {code: {start,end}}, errors } */
export async function runFinanceFetch() {
  const codes = Object.keys(TRADE_TIMES)
  const settled = await Promise.all(
    codes.map(async (code) => {
      try {
        const text = await fetchQuoteText(code)
        return [code, parseResponse(code, text), null]
      } catch (err) {
        return [code, null, err && err.message ? err.message : String(err)]
      }
    }),
  )
  const quotes = {}
  const errors = {}
  for (const [code, q, err] of settled) {
    if (q) quotes[code] = q
    else errors[code] = err
  }
  return { quotes, trade: TRADE_TIMES, errors }
}