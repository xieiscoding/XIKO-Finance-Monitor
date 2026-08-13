import * as THREE from 'three'

/* ===== Geodetic coordinates -> sphere surface coordinates =====
   Consistent with the UV mapping of THREE.SphereGeometry (and the equirectangular projection texture):
   longitude 0° / latitude 0° corresponds to the +X direction of the sphere.
   The formula is equivalent to the point on the sphere surface at texture coordinate u=(lon+180)/360. */
export function latLonToVec3(lat, lon, radius) {
  const phi = THREE.MathUtils.degToRad(lat)
  const lam = THREE.MathUtils.degToRad(lon)
  return new THREE.Vector3(
    radius * Math.cos(lam) * Math.cos(phi),
    radius * Math.sin(phi),
    -radius * Math.sin(lam) * Math.cos(phi),
  )
}

/* 图标防重叠布局：
   每个图标初始位于其地区经纬度（锚点）方向，然后迭代松弛：
   - 中心间距小于 minSep 的图标互相推开（越靠近偏移上限的图标越少动）；
   - 每步重新投影到半径 iconRadius 的悬浮球面；
   - 图标相对锚点的角偏移始终不超过 maxOffsetDeg，保证图标仍在地区附近。
   过程完全确定（无随机数），返回 code -> THREE.Vector3（图标中心坐标）。 */
export function layoutIconPositions(coords, iconRadius, options = {}) {
  const { minSep = 16, maxOffsetDeg = 13, iterations = 600 } = options
  const codes = Object.keys(coords)
  const anchorDir = new Map()
  const pos = new Map()
  for (const code of codes) {
    const dir = latLonToVec3(coords[code].lat, coords[code].lon, 1).normalize()
    anchorDir.set(code, dir)
    pos.set(code, dir.clone().multiplyScalar(iconRadius))
  }
  const maxAngle = THREE.MathUtils.degToRad(maxOffsetDeg)
  const tmp = new THREE.Vector3()
  const dirI = new THREE.Vector3()
  for (let iter = 0; iter < iterations; iter++) {
    let worstOverlap = 0
    /* 重叠的图标沿两者连线方向推开 */
    for (let i = 0; i < codes.length; i++) {
      const pi = pos.get(codes[i])
      for (let j = i + 1; j < codes.length; j++) {
        const pj = pos.get(codes[j])
        const dist = pi.distanceTo(pj)
        if (dist >= minSep) continue
        const overlap = minSep - dist + 0.02
        worstOverlap = Math.max(worstOverlap, overlap)
        tmp.copy(pi).sub(pj)
        if (tmp.lengthSq() < 1e-12) tmp.set(0, 1, 0) /* 完全重合时任取一个方向 */
        tmp.normalize()
        /* 剩余偏移余量多的图标多移动，避免把已贴边的图标推出上限 */
        const roomI = Math.max(0, maxAngle - pi.angleTo(anchorDir.get(codes[i])))
        const roomJ = Math.max(0, maxAngle - pj.angleTo(anchorDir.get(codes[j])))
        const wI = roomI + roomJ > 0 ? roomI / (roomI + roomJ) : 0.5
        pi.addScaledVector(tmp, overlap * wI)
        pj.addScaledVector(tmp, -overlap * (1 - wI))
        pi.normalize().multiplyScalar(iconRadius)
        pj.normalize().multiplyScalar(iconRadius)
      }
    }
    /* 超过最大偏移角的图标拉回角上限处 */
    let clamped = false
    for (const code of codes) {
      const p = pos.get(code)
      const anchor = anchorDir.get(code)
      const angle = p.angleTo(anchor)
      if (angle <= maxAngle) continue
      clamped = true
      dirI.copy(p).normalize()
      p.copy(anchor).lerp(dirI, maxAngle / angle).normalize().multiplyScalar(iconRadius)
    }
    if (worstOverlap === 0 && !clamped) break
  }
  return pos
}

/* Display coordinates (lat/lon) corresponding to the "country-province" of each index.
   Uses the actual coordinates of each exchange location; densely packed areas
   (eastern US, southern China, western Europe, etc.) are separated at runtime by
   layoutIconPositions, which spreads icons apart and connects them back to their
   anchor points with leader lines. */
export const REGION_COORDS = {
  /* China */
  sh000001: { region: '中国-上海', lat: 31.2, lon: 121.5 },
  sz399001: { region: '中国-深圳', lat: 22.55, lon: 114.06 },
  hkHSI:    { region: '中国-香港', lat: 22.3, lon: 114.2 },
  ftXIN9:   { region: '中国', lat: 39.9, lon: 116.4 },
  gzTWII:   { region: '中国-台湾', lat: 25.0, lon: 121.6 },
  /* Asia-Pacific */
  gzN225:   { region: '日本', lat: 35.7, lon: 139.7 },
  gzKS11:   { region: '韩国', lat: 37.6, lon: 127.0 },
  gzFTSTI:  { region: '新加坡', lat: 1.3, lon: 103.8 },
  ftFBMKLCI:{ region: '马来西亚', lat: 7.0, lon: 100.7 },
  gzENSEX:  { region: '印度', lat: 19.1, lon: 72.9 },
  gzS51:    { region: '澳大利亚', lat: -33.9, lon: 151.2 },
  /* Europe */
  ukUKX:    { region: '英国', lat: 51.5, lon: -0.1 },
  ftDAX30:  { region: '德国', lat: 50.1, lon: 8.7 },
  ftE3X:    { region: '欧洲', lat: 47.6, lon: 15.0 },
  ftFTSEMIB:{ region: '意大利', lat: 45.5, lon: 9.2 },
  gzFCHI:   { region: '法国', lat: 48.9, lon: 2.3 },
  gzIBEX:   { region: '西班牙', lat: 40.4, lon: -3.7 },
  gzAEX:    { region: '荷兰', lat: 53.8, lon: 4.6 },
  gzPSI20:  { region: '葡萄牙', lat: 38.7, lon: -9.1 },
  /* Americas */
  gzGSPTSE: { region: '加拿大', lat: 43.7, lon: -79.4 },
  gzMXX:    { region: '墨西哥', lat: 19.4, lon: -99.1 },
  s_usDJI:  { region: '美国', lat: 40.7, lon: -74.0 },
  s_usINX:  { region: '美国', lat: 45.0, lon: -71.5 },
  s_usIXIC: { region: '美国', lat: 36.3, lon: -77.5 },
}

/* 把可能跨越 ±180° 经线的环切开：每个跨线处拆成两段，断点补到地图左右边缘。
   不切开的话，画布会把跨线线段画成横穿整张贴图的直线
   （斐济、俄罗斯楚科奇、南极洲的环都有这种情况）。
   环是闭合的，切出的尾段会与首段重新拼接；无跨线时原样返回单段。 */
function splitRingAtDateline(ring) {
  const pieces = []
  let cur = [ring[0]]
  for (let i = 1; i < ring.length; i++) {
    const lon1 = ring[i - 1][0], lat1 = ring[i - 1][1]
    const lon2 = ring[i][0], lat2 = ring[i][1]
    const dLon = lon2 - lon1
    if (Math.abs(dLon) <= 180) { cur.push([lon2, lat2]); continue }
    /* 把 lon2 展开到 lon1 同侧（沿"短路径"），线性插值出跨线处的纬度 */
    const lon2u = dLon > 180 ? lon2 - 360 : lon2 + 360
    const edge = lon1 >= 0 ? 180 : -180
    const denom = lon2u - lon1
    const t = Math.abs(denom) < 1e-9 ? 0 : (edge - lon1) / denom
    const latC = lat1 + (lat2 - lat1) * t
    cur.push([edge, latC])
    pieces.push(cur)
    cur = [[-edge, latC], [lon2, lat2]]
  }
  pieces.push(cur)
  if (pieces.length > 1) pieces[0] = pieces.pop().concat(pieces[0])
  return pieces
}

/* Build the "minimal mode" equirectangular texture canvas (used as the sphere texture):
   ocean = slightly lighter deep blue, land = deeper deep blue,
   borders / coastlines stroked in a slightly brighter tone.
   Rings crossing ±180° are split before drawing so no line spans the whole map;
   a chain spanning both map edges (Antarctica) is closed via pole corners so the
   land fills down to the pole.
   features: countries parsed by topojson-client's feature(). */
export function buildMinimalMapCanvas(features, width = 2048, height = 1024) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  /* Ocean: slightly lighter deep blue */
  ctx.fillStyle = '#173a5e'
  ctx.fillRect(0, 0, width, height)
  /* Land: deep blue; strokes slightly brighter to show borders / coastlines */
  ctx.fillStyle = '#0c1f38'
  ctx.strokeStyle = 'rgba(139, 173, 216, 0.55)'
  ctx.lineWidth = 1.1
  ctx.lineJoin = 'round'
  const toX = (lon) => ((lon + 180) / 360) * width
  const toY = (lat) => ((90 - lat) / 180) * height
  for (const f of features) {
    const g = f.geometry
    if (!g) continue
    const polys =
      g.type === 'Polygon' ? [g.coordinates]
      : g.type === 'MultiPolygon' ? g.coordinates
      : []
    for (const poly of polys) {
      /* 填充：所有环切开后合并成一个 even-odd 路径 */
      ctx.beginPath()
      for (const ring of poly) {
        for (const chain of splitRingAtDateline(ring)) {
          ctx.moveTo(toX(chain[0][0]), toY(chain[0][1]))
          for (let i = 1; i < chain.length; i++) ctx.lineTo(toX(chain[i][0]), toY(chain[i][1]))
          /* 横跨地图左右边缘的单段（如南极洲）：补上极点角点闭合，让陆地填到贴图边缘 */
          const a = chain[0]
          const b = chain[chain.length - 1]
          if (Math.abs(Math.abs(a[0]) - 180) < 1e-6 && Math.abs(Math.abs(b[0]) - 180) < 1e-6 && a[0] !== b[0]) {
            const poleLat = (a[1] + b[1]) / 2 < 0 ? -90 : 90
            ctx.lineTo(toX(b[0]), toY(poleLat))
            ctx.lineTo(toX(a[0]), toY(poleLat))
          }
          ctx.closePath()
        }
      }
      ctx.fill('evenodd') /* outer ring + inner rings (lakes etc.) via even-odd rule */
      /* 描边：只画海岸线折线本身（开放路径），不画填充用的闭合补边 */
      for (const ring of poly) {
        for (const chain of splitRingAtDateline(ring)) {
          ctx.beginPath()
          ctx.moveTo(toX(chain[0][0]), toY(chain[0][1]))
          for (let i = 1; i < chain.length; i++) ctx.lineTo(toX(chain[i][0]), toY(chain[i][1]))
          ctx.stroke()
        }
      }
    }
  }
  return canvas
}
