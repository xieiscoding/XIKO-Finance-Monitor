import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { CSS3DRenderer, CSS3DObject } from 'three/addons/renderers/CSS3DRenderer.js'
import { feature } from 'topojson-client'
import { subsolarLongitude } from './sun'
import { REGION_COORDS, latLonToVec3, buildMinimalMapCanvas, layoutIconPositions } from './geo'
import { changeColor, fmtPct, fmtValue } from './format'

/**
 * 【部件】三维地球（全球指数行情）
 *
 * 功能：
 *  - 卫星地图 / 极简地图（深蓝海洋 + 深蓝陆地、国界/海岸线）切换，
 *    切换按钮为地球右侧的圆角方形（上"卫星" / 下"极简"，内嵌横向小胶囊）；
 *  - 地球可自由拖动（双轴）；自动恢复时始终回到赤道线所在的经度；
 *  - 每 5 分钟读取一次当前太阳直射经度，并以"先加速再减速"动画转过去；
 *  - 支持按住拖动；无操作 10 秒后自动转回太阳直射经度；
 *  - 各指数圆形图标按"国家-省份"经纬度定位（CSS3D，略微悬浮）；图标自动防重叠布局，
 *    偏移时用一条细引导线连回地区锚点；转过边缘时显示图标"反面"，仅在被地球遮挡时隐藏；
 *    交易时段内外圈每 3s 向外扩散一圈蓝色，涨跌幅越大越红 / 越绿；
 *  - 鼠标悬停图标时，紧贴鼠标右侧弹出磨砂悬浮框（getroughdata 返回结果，除 code），跟随鼠标移动。
 */

/* ===== 常量 ===== */
const GLOBE_RADIUS = 100
const MARKER_FLOAT = 1.07 /* 图标悬浮高度（相对半径的比例） */
const MARKER_SCALE = 0.32 /* CSS3D 图标缩放（px → 场景单位） */
const MARKER_MIN_SEP = 16 /* 图标中心最小间距（场景单位），防止相互重叠 */
const MARKER_MAX_OFFSET_DEG = 13 /* 图标相对地区锚点的最大偏移角（度） */
const MARKER_SIZE = 42 /* 图标元素边长（px），须与 .fm-marker 一致 */
const CLIP_FAR = 200 /* 遮挡裕量超过该值视为完全可见 / 完全被挡（场景单位） */
const CLIP_EPS = 3 /* 遮挡边界数值梯度的采样步长（场景单位） */
const SUN_CHECK_MS = 5 * 60 * 1000 /* 每 5 分钟识别一次太阳直射经度并转动 */
const IDLE_RETURN_MS = 10 * 1000 /* 无操作 10 秒后自动转回太阳直射经度 */

const MAX_TILT = THREE.MathUtils.degToRad(85) /* 拖动时的倾角上限 */

/* 先加速再减速 */
const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

/* 角度差归一化到 [-π, π]，保证沿最短路径转动 */
const wrapAngle = (a) => {
  let r = a
  while (r > Math.PI) r -= Math.PI * 2
  while (r < -Math.PI) r += Math.PI * 2
  return r
}

/* 使某条经线正对相机（转向前方）时，地球绕 Y 轴应有的角度。
   推导：SpherGeometry 贴图下，经度 L 的点位于 (cosL, ·, -sinL)，
   绕 Y 转 θ 后正对 +Z 的条件是 sin(L + θ) = -1，即 θ = -90° - L。 */
const rotYForLon = (lon) => THREE.MathUtils.degToRad(-90 - lon)

/* 是否正处于交易时段（start / end 为北京时间，支持跨零点时段，如 21:30 - 04:00） */
function isTradingNow(t) {
  if (!t) return false
  const toSec = (s) => {
    const p = String(s).split(':').map(Number)
    return (p[0] || 0) * 3600 + (p[1] || 0) * 60 + (p[2] || 0)
  }
  const bj = new Date(Date.now() + 8 * 3600 * 1000) /* UTC+8，无夏令时 */
  const cur = bj.getUTCHours() * 3600 + bj.getUTCMinutes() * 60 + bj.getUTCSeconds()
  const s = toSec(t.start)
  const e = toSec(t.end)
  return s <= e ? cur >= s && cur < e : cur >= s || cur < e
}

const escapeHtml = (s) =>
  String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ))

/* 悬浮框罗列 getroughdata 的返回字段（不含 code） */
const TIP_FIELDS = ['中文名称', '英文全称', '英文简称', '国家-省份', '更新时间', '指数数值', '涨跌幅(%)']

export default function GlobeWidget({ quotes, trade, error }) {
  const hostRef = useRef(null)
  const tipRef = useRef(null)
  const markersRef = useRef(new Map()) /* code -> { obj, el, pos, regionEl, valueEl, pctEl } */
  const hoverRef = useRef(null)
  const dataRef = useRef({ quotes: null, trade: null })
  dataRef.current = { quotes, trade }

  /* 地球旋转 / 动画状态机（不触发 React 重渲染） */
  const stateRef = useRef({
    theta: rotYForLon(subsolarLongitude(new Date())), /* 初始即对准太阳直射经度 */
    phi: 0, /* 绕赤道轴的倾角（自由拖动），自动恢复时归零 */
    anim: null,
    dragging: false,
    lastX: 0,
    lastY: 0,
    lastInteraction: 0,
    idleReturned: true,
    lastSunCheck: 0,
    satTarget: 1,
    minTarget: 0,
  })
  const [mode, setMode] = useState('satellite')

  /* 切换卫星 / 极简：只改渐变目标，渲染循环里做交叉淡化 */
  useEffect(() => {
    const st = stateRef.current
    st.satTarget = mode === 'satellite' ? 1 : 0
    st.minTarget = mode === 'minimal' ? 1 : 0
  }, [mode])

  /* ===== 悬浮框：填充内容 / 跟随鼠标 ===== */
  function fillTip(code) {
    const tip = tipRef.current
    if (!tip) return
    const q = (dataRef.current.quotes || {})[code]
    const rows = TIP_FIELDS.map((k) => {
      let v = q ? q[k] : null
      if (k === '指数数值') v = q ? fmtValue(q[k]) : '--'
      else if (k === '涨跌幅(%)') v = q ? fmtPct(q[k]) : '--'
      else if (v == null || v === '') v = '—'
      return (
        '<div class="fm-tip__row"><span class="fm-tip__k">' +
        escapeHtml(k) +
        '</span><span class="fm-tip__v">' +
        escapeHtml(v) +
        '</span></div>'
      )
    })
    tip.innerHTML = rows.join('')
  }

  function placeTip(x, y) {
    const tip = tipRef.current
    if (!tip) return
    const gap = -192 /* 紧贴鼠标右侧 */
    const r = tip.getBoundingClientRect()
    let left = x + gap
    let top = y - r.height / 2
    if (left + r.width > window.innerWidth - 8) left = x - r.width - gap
    if (top + r.height > window.innerHeight - 8) top = window.innerHeight - 8 - r.height
    if (top < 8) top = 8
    tip.style.left = left + 'px'
    tip.style.top = top + 'px'
  }

  /* ===== 行情数据更新 → 刷新图标文字 / 配色 / 交易扩散动画 ===== */
  useEffect(() => {
    markersRef.current.forEach((mk, code) => {
      const q = quotes && quotes[code]
      if (!q) return
      if (q['国家-省份']) mk.regionEl.textContent = q['国家-省份']
      mk.valueEl.textContent = fmtValue(q['指数数值'])
      mk.pctEl.textContent = fmtPct(q['涨跌幅(%)'])
      const color = changeColor(q['涨跌幅(%)'])
      mk.valueEl.style.color = color
      mk.pctEl.style.color = color
      mk.el.classList.toggle('is-live', isTradingNow(trade && trade[code]))
    })
    /* 悬浮框正打开时同步刷新内容 */
    if (hoverRef.current) fillTip(hoverRef.current)
  }, [quotes, trade])

  /* ===== 三维场景（挂载时初始化一次） ===== */
  useEffect(() => {
    const host = hostRef.current
    if (!host) return undefined
    const st = stateRef.current
    let disposed = false

    const scene = new THREE.Scene()
    const cssScene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(42, 1, 1, 4000)
    camera.position.set(0, 0, 320)

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.setClearColor(0x000000, 0)
    renderer.domElement.className = 'fm-globe__canvas'
    host.appendChild(renderer.domElement)

    /* CSS3D 层：承载真实 DOM 图标，与 WebGL 共用相机 */
    const cssRenderer = new CSS3DRenderer()
    cssRenderer.domElement.className = 'fm-globe__css'
    host.appendChild(cssRenderer.domElement)

    const globeGroup = new THREE.Group()
    scene.add(globeGroup)
    const cssGlobeGroup = new THREE.Group()
    cssScene.add(cssGlobeGroup)

    /* 光照：平行光跟随相机 —— 太阳直射经度始终朝前，等效正前方受光 */
    scene.add(new THREE.AmbientLight(0xffffff, 1.35))
    const sunLight = new THREE.DirectionalLight(0xffffff, 2.2)
    scene.add(sunLight)

    /* 球体：卫星（贴图）与极简（纯色）共用几何，按透明度交叉淡化 */
    const sphereGeo = new THREE.SphereGeometry(GLOBE_RADIUS, 96, 96)
    const satMat = new THREE.MeshPhongMaterial({
      color: 0x2c3e55, /* 贴图加载完成前显示深海蓝色 */
      specular: 0x16222e,
      shininess: 12,
      transparent: true,
      opacity: 1,
    })
    const satMesh = new THREE.Mesh(sphereGeo, satMat)
    /* 极简球体必须写入深度，否则会透出其后的"大气层"背面壳，在内部形成明亮光斑 */
    const minMat = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0,
    })
    const minMesh = new THREE.Mesh(sphereGeo, minMat)
    minMesh.visible = false
    globeGroup.add(satMesh, minMesh)

    new THREE.TextureLoader().load('/globe/earth-blue-marble.jpg', (tex) => {
      if (disposed) return
      tex.colorSpace = THREE.SRGBColorSpace
      tex.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy())
      satMat.map = tex
      satMat.color.set(0xffffff)
      satMat.needsUpdate = true
    })

    /* 极简模式贴图：深蓝海洋 + 深蓝陆地（国界/海岸线已烘焙进贴图），与卫星贴图交叉淡化 */
    fetch('/globe/countries-110m.json')
      .then((r) => r.json())
      .then((topo) => {
        if (disposed) return
        const feats = feature(topo, topo.objects.countries).features
        const tex = new THREE.CanvasTexture(buildMinimalMapCanvas(feats))
        tex.colorSpace = THREE.SRGBColorSpace
        tex.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy())
        minMat.map = tex
        minMat.needsUpdate = true
      })
      .catch(() => {})

    /* 大气辉光（背面壳 + 加色混合）：淡蓝色，模拟从太空看真实大气层的颜色 */
    const atmo = new THREE.Mesh(
      new THREE.SphereGeometry(GLOBE_RADIUS * 1.06, 64, 64),
      new THREE.ShaderMaterial({
        vertexShader:
          'varying vec3 vN; void main(){ vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader:
          'varying vec3 vN; void main(){ float i = pow(max(0.66 - dot(vN, vec3(0.0, 0.0, 1.0)), 0.0), 4.0); gl_FragColor = vec4(0.62, 0.84, 1.0, 1.0) * i * 0.7; }',
        side: THREE.BackSide,
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false,
      }),
    )
    atmo.renderOrder = 1 /* 让大气在球体之后绘制，其背面才能被球体深度正确遮挡 */
    scene.add(atmo)

    /* ===== 指数圆形图标（CSS3D，略微悬浮）：防重叠布局 + 细引导线连回地区锚点 ===== */
    const markers = markersRef.current
    markers.forEach((mk) => { cssGlobeGroup.remove(mk.obj); mk.el.remove() })
    markers.clear()
    /* 图标中心位置：从地区锚点出发迭代松弛，互不重叠且偏离锚点不超过上限 */
    const iconPos = layoutIconPositions(REGION_COORDS, GLOBE_RADIUS * MARKER_FLOAT, {
      minSep: MARKER_MIN_SEP,
      maxOffsetDeg: MARKER_MAX_OFFSET_DEG,
    })
    /* 引导线与锚点圆点放在 WebGL 层，随地球旋转并被球体自动深度遮挡 */
    const leaders = []
    const leaderMat = new THREE.LineBasicMaterial({ color: 0xd9e2f0, transparent: true, opacity: 0.55 })
    const anchorDotGeo = new THREE.SphereGeometry(1.15, 10, 10)
    const anchorDotMat = new THREE.MeshBasicMaterial({ color: 0xd9e2f0, transparent: true, opacity: 0.9 })
    Object.entries(REGION_COORDS).forEach(([code, coord]) => {
      const el = document.createElement('div')
      el.className = 'fm-marker'
      el.innerHTML =
        '<span class="fm-marker__pulse"></span>' +
        '<div class="fm-marker__region">' + escapeHtml(coord.region) + '</div>' +
        '<div class="fm-marker__value">--</div>' +
        '<div class="fm-marker__pct">--</div>'
      const pos = iconPos.get(code)
      const obj = new CSS3DObject(el)
      obj.position.copy(pos)
      obj.lookAt(pos.clone().multiplyScalar(2)) /* +Z 朝外 → 平面切于球面 */
      obj.scale.setScalar(MARKER_SCALE)
      cssGlobeGroup.add(obj)
      /* 图标两个像素轴在随地球旋转坐标系中的方向（x 向右、y 向下），供遮挡裁剪用 */
      const axisX = new THREE.Vector3(1, 0, 0).applyQuaternion(obj.quaternion)
      const axisY = new THREE.Vector3(0, -1, 0).applyQuaternion(obj.quaternion)

      /* 细线从地区锚点（球面）连到图标中心，锚点处加一个小圆点 */
      const anchor = latLonToVec3(coord.lat, coord.lon, GLOBE_RADIUS * 1.002)
      const lineGeo = new THREE.BufferGeometry().setFromPoints([anchor, pos])
      const line = new THREE.Line(lineGeo, leaderMat)
      globeGroup.add(line)
      const dot = new THREE.Mesh(anchorDotGeo, anchorDotMat)
      dot.position.copy(anchor)
      globeGroup.add(dot)
      leaders.push({ line, lineGeo, dot })

      markers.set(code, {
        obj, el, pos, axisX, axisY,
        lastClip: '',
        regionEl: el.querySelector('.fm-marker__region'),
        valueEl: el.querySelector('.fm-marker__value'),
        pctEl: el.querySelector('.fm-marker__pct'),
      })

      el.addEventListener('mouseenter', (e) => {
        hoverRef.current = code
        fillTip(code)
        const tip = tipRef.current
        if (tip) {
          tip.classList.add('fm-tip--open')
          placeTip(e.clientX, e.clientY)
        }
      })
      el.addEventListener('mousemove', (e) => placeTip(e.clientX, e.clientY))
      el.addEventListener('mouseleave', () => {
        hoverRef.current = null
        const tip = tipRef.current
        if (tip) tip.classList.remove('fm-tip--open')
      })
    })

    /* ===== 尺寸自适应：地球（含大气）始终完整可见 ===== */
    const resize = () => {
      const w = host.clientWidth || 1
      const h = host.clientHeight || 1
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      renderer.setSize(w, h)
      cssRenderer.setSize(w, h)
      const halfV = THREE.MathUtils.degToRad(camera.fov) / 2
      const halfH = Math.atan(Math.tan(halfV) * camera.aspect)
      camera.position.z = (GLOBE_RADIUS * 1.071) / Math.sin(Math.min(halfV, halfH))
    }
    resize()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null
    if (ro) ro.observe(host)
    else window.addEventListener('resize', resize)

    /* ===== 转动动画：先加速再减速，沿最短路径（theta 绕极轴、phi 绕赤道轴） ===== */
    const startAnim = (toTheta, toPhi = 0) => {
      const dTheta = wrapAngle(toTheta - st.theta)
      const dPhi = toPhi - st.phi
      if (Math.abs(dTheta) < 0.003 && Math.abs(dPhi) < 0.003) return
      const dur = Math.min(2400, Math.max(900, 900 + (1300 * Math.max(Math.abs(dTheta), Math.abs(dPhi))) / Math.PI))
      st.anim = { fromT: st.theta, toT: st.theta + dTheta, fromP: st.phi, toP: toPhi, start: performance.now(), dur }
    }

    /* ===== 主循环 ===== */
    const tmpW = new THREE.Vector3()
    const tmpC = new THREE.Vector3()
    const tmpA = new THREE.Vector3()
    const tmpB = new THREE.Vector3()
    const tmpE = new THREE.Euler()

    /* 点 P 的遮挡裕量：相机→P 射线先击中球面则 P 被挡。
       返回值 >0 表示可见（交点在 P 之后多远），<0 表示被挡（P 在交点后多深），
       Infinity 表示射线根本击不中球面。 */
    const occMargin = (P) => {
      tmpC.copy(P).sub(camera.position)
      const dist = tmpC.length()
      tmpC.divideScalar(dist || 1)
      const b = tmpC.dot(camera.position)
      const disc = b * b - camera.position.lengthSq() + GLOBE_RADIUS * GLOBE_RADIUS
      if (disc <= 0) return Infinity
      const hit = -b - Math.sqrt(disc)
      if (hit <= 0) return Infinity
      return hit - dist
    }
    let raf = 0

    const tick = (now) => {
      raf = requestAnimationFrame(tick)

      /* 旋转状态机：动画播放中 → 推进；否则检查"5 分钟随日转动"与"10 秒无操作回转" */
      if (st.anim) {
        const t = (now - st.anim.start) / st.anim.dur
        if (t >= 1) {
          st.theta = st.anim.toT
          st.phi = st.anim.toP
          st.anim = null
        } else {
          const e = easeInOutCubic(Math.max(0, t))
          st.theta = st.anim.fromT + (st.anim.toT - st.anim.fromT) * e
          st.phi = st.anim.fromP + (st.anim.toP - st.anim.fromP) * e
        }
      } else if (!st.dragging) {
        if (st.lastSunCheck && now - st.lastSunCheck >= SUN_CHECK_MS) {
          st.lastSunCheck = now
          startAnim(rotYForLon(subsolarLongitude(new Date())), 0)
        } else if (!st.idleReturned && st.lastInteraction && now - st.lastInteraction >= IDLE_RETURN_MS) {
          st.idleReturned = true
          startAnim(rotYForLon(subsolarLongitude(new Date())), 0)
        }
      }
      if (!st.lastSunCheck) st.lastSunCheck = now

      /* 自由旋转：theta 绕极轴、phi 绕赤道轴 */
      globeGroup.rotation.set(st.phi, st.theta, 0)
      cssGlobeGroup.rotation.set(st.phi, st.theta, 0)

      /* 卫星 / 极简交叉淡化 */
      satMat.opacity += (st.satTarget - satMat.opacity) * 0.14
      minMat.opacity += (st.minTarget - minMat.opacity) * 0.14
      satMesh.visible = satMat.opacity > 0.02
      minMesh.visible = minMat.opacity > 0.02

      sunLight.position.copy(camera.position)

      /* 图标遮挡：逐图标计算地球球面在其平面上的遮挡边界，用 clip-path
         一点一点裁掉被地球挡住的部分；转过边缘时 CSS3D 元素自然显示镜像"反面" */
      tmpE.set(st.phi, st.theta, 0)
      markers.forEach((mk) => {
        tmpW.copy(mk.pos).applyEuler(tmpE) /* 图标中心世界坐标 */
        const m0 = occMargin(tmpW)
        let clip = 'none'
        let hidden = false
        if (!Number.isFinite(m0) || m0 > CLIP_FAR) {
          clip = 'none' /* 完全可见 */
        } else if (m0 < -CLIP_FAR) {
          hidden = true /* 深深藏在地球背后 */
        } else {
          /* 边界附近：沿图标两轴数值梯度，得到像素坐标系里的遮挡直线 */
          tmpA.copy(mk.axisX).applyEuler(tmpE)
          tmpB.copy(mk.axisY).applyEuler(tmpE)
          const gm = (axis, sign) => {
            tmpC.copy(tmpW).addScaledVector(axis, sign * CLIP_EPS)
            return Math.min(occMargin(tmpC), CLIP_FAR)
          }
          const ax = ((gm(tmpA, 1) - gm(tmpA, -1)) / (2 * CLIP_EPS)) * MARKER_SCALE
          const ay = ((gm(tmpB, 1) - gm(tmpB, -1)) / (2 * CLIP_EPS)) * MARKER_SCALE
          const half = MARKER_SIZE / 2
          const corners = [[0, 0], [MARKER_SIZE, 0], [MARKER_SIZE, MARKER_SIZE], [0, MARKER_SIZE]]
          const poly = []
          let cut = false
          for (let i = 0; i < 4; i++) {
            const A = corners[i]
            const B = corners[(i + 1) % 4]
            const fA = m0 + ax * (A[0] - half) + ay * (A[1] - half)
            const fB = m0 + ax * (B[0] - half) + ay * (B[1] - half)
            if (fA >= 0) poly.push(A)
            if ((fA >= 0) !== (fB >= 0)) {
              cut = true
              const t = fA / (fA - fB)
              poly.push([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t])
            }
          }
          if (poly.length < 3) hidden = true
          else if (cut) clip = 'polygon(' + poly.map((p) => p[0].toFixed(1) + 'px ' + p[1].toFixed(1) + 'px').join(', ') + ')'
        }
        const state = hidden ? 'hidden' : clip
        if (mk.lastClip !== state) {
          mk.lastClip = state
          if (hidden) {
            mk.el.style.visibility = 'hidden'
          } else {
            mk.el.style.visibility = 'visible'
            mk.el.style.clipPath = clip
          }
        }
        mk.el.style.pointerEvents = hidden || m0 <= 0 ? 'none' : 'auto'
      })

      renderer.render(scene, camera)
      cssRenderer.render(cssScene, camera)
    }
    raf = requestAnimationFrame(tick)

    /* ===== 拖动：按住地球手动旋转（仅水平方向） ===== */
    const dom = renderer.domElement
    const onDown = (e) => {
      if (e.button !== undefined && e.button !== 0) return
      st.dragging = true
      st.anim = null
      st.idleReturned = false
      st.lastX = e.clientX
      st.lastY = e.clientY
      dom.classList.add('fm-globe__canvas--grabbing')
      try { dom.setPointerCapture(e.pointerId) } catch { /* 部分浏览器不支持，忽略 */ }
    }
    const onMove = (e) => {
      if (!st.dragging) return
      const dx = e.clientX - st.lastX
      const dy = e.clientY - st.lastY
      st.lastX = e.clientX
      st.lastY = e.clientY
      const k = (Math.PI * 2 * 1.25) / Math.max(host.clientWidth || 300, 200)
      st.theta += dx * k
      st.phi = THREE.MathUtils.clamp(st.phi + dy * k, -MAX_TILT, MAX_TILT)
      st.lastInteraction = performance.now()
    }
    const onUp = () => {
      if (!st.dragging) return
      st.dragging = false
      st.lastInteraction = performance.now()
      dom.classList.remove('fm-globe__canvas--grabbing')
    }
    dom.addEventListener('pointerdown', onDown)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)

    return () => {
      disposed = true
      cancelAnimationFrame(raf)
      if (ro) ro.disconnect()
      else window.removeEventListener('resize', resize)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      markers.forEach((mk) => { cssGlobeGroup.remove(mk.obj); mk.el.remove() })
      markers.clear()
      leaders.forEach(({ line, lineGeo, dot }) => {
        globeGroup.remove(line)
        globeGroup.remove(dot)
        lineGeo.dispose()
      })
      leaderMat.dispose()
      anchorDotGeo.dispose()
      anchorDotMat.dispose()
      renderer.dispose()
      sphereGeo.dispose()
      satMat.dispose()
      if (minMat.map) minMat.map.dispose()
      minMat.dispose()
      if (renderer.domElement.parentNode === host) host.removeChild(renderer.domElement)
      if (cssRenderer.domElement.parentNode === host) host.removeChild(cssRenderer.domElement)
    }
  }, [])

  const toggleMode = () => setMode((m) => (m === 'satellite' ? 'minimal' : 'satellite'))

  return (
    <div className="fm-globe">
      <div className="fm-globe__col">
        <div className="fm-globe__host" ref={hostRef} />
        <div className="fm-status">
          {quotes
            ? (
              <>
                实时行情 · 交易时段按北京时间(UTC+8) · 数据来源
                <a
                  className="fm-status__link"
                  href="https://stockapp.finance.qq.com/"
                  target="_blank"
                  rel="noreferrer"
                >
                  腾讯证券
                </a> · 仅供学习交流任何侵权行为与本网站无关
              </>
            )
            : '正在首次加载全球行情（初始化 Python 运行环境）……'}
          {error && quotes ? <span className="fm-status__err">刷新异常：{error}</span> : null}
        </div>
      </div>
      <button
        type="button"
        className="fm-globe-toggle"
        onClick={toggleMode}
        aria-label="切换卫星 / 极简地图"
      >
        <span
          className={'fm-globe-toggle__knob' + (mode === 'minimal' ? ' fm-globe-toggle__knob--min' : '')}
          aria-hidden="true"
        />
        <span className={'fm-globe-toggle__opt' + (mode === 'satellite' ? ' fm-globe-toggle__opt--active' : '')}>卫星</span>
        <span className={'fm-globe-toggle__opt' + (mode === 'minimal' ? ' fm-globe-toggle__opt--active' : '')}>极简</span>
      </button>
      <div className="fm-tip" ref={tipRef} role="tooltip" />
    </div>
  )
}
