/* ===== A-share index data runner (frontend-embedded implementation) =====
   No longer depends on any xlsx / .py files: parsing logic equivalent to the original
   financemonitor_v1/Ashare/index/getindexdata.py is embedded directly into the frontend.
   The browser requests the Tencent quote API and parses itself:
   URL is uniformly https://qt.gtimg.cn/q=<code>; the response is GBK text with ~-separated fields:
     [1] index short name  [2] index code (in-market)  [3] index value  [32] change pct (%)
   Returns { indices, errors }. The frontend calls this once every 3 seconds to refresh. */

const quoteUrl = (code) => 'https://qt.gtimg.cn/q=' + code

const toFloat = (text) => {
  const t = String(text == null ? '' : text).trim()
  if (!t) return null
  const v = Number(t)
  return Number.isFinite(v) ? v : null
}

function parseIndex(code, text) {
  const m = /"([^"]*)"/.exec(text)
  if (!m) throw new Error('返回内容中未找到引号包裹的数据: ' + text.slice(0, 120))
  const fields = m[1].split('~')
  const g = (i) => (i < fields.length ? fields[i] : '')
  return {
    '指数简称': g(1),
    '指数代码': g(2),
    '指数数值': toFloat(g(3)),
    '涨跌幅(%)': toFloat(g(32)),
  }
}

/* Run one fetch: returns { indices: {code: 4-item index info}, errors } */
export async function runIndexFetch(codes) {
  const settled = await Promise.all(
    codes.map(async (code) => {
      try {
        const resp = await fetch(quoteUrl(code))
        if (!resp.ok) throw new Error('行情接口请求失败（HTTP ' + resp.status + '）: ' + code)
        const buf = await resp.arrayBuffer()
        let decoder
        try {
          decoder = new TextDecoder('gbk')
        } catch {
          decoder = new TextDecoder('utf-8')
        }
        return [code, parseIndex(code, decoder.decode(buf)), null]
      } catch (err) {
        return [code, null, err && err.message ? err.message : String(err)]
      }
    }),
  )
  const indices = {}
  const errors = {}
  for (const [code, d, err] of settled) {
    if (d) indices[code] = d
    else errors[code] = err
  }
  return { indices, errors }
}