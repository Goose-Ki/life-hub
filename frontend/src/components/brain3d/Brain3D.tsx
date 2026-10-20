import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { Achievement, ZoneKey } from '../../api'
import type { ZoneMeta, ZoneXP } from '../brain/BrainCanvas'
import { buildModel, litFor, Model, ZONE_HEX, ZONES } from './shape'

interface Props {
  xp: ZoneXP
  fromXp?: ZoneXP
  achievements?: Achievement[]
  zoneMeta?: Partial<Record<ZoneKey, ZoneMeta>>
  highlight?: ZoneKey | null
  celebrate?: boolean
  compact?: boolean
  onHoverZone?: (z: ZoneKey | null) => void
  onGrown?: () => void
}

interface Tip { x: number; y: number; title: string; sub?: string; color: string }

const GROW_MS = 3000
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3)
const clamp01 = (v: number) => Math.max(0, Math.min(1, v))

// Один шейдер для всех «светящихся точек»: мягкая точка, кольцо (навык) или квадрат (книга).
const pointsVert = /* glsl */ `
  attribute vec3 aColor;
  attribute float aAlpha;
  attribute float aSize;
  attribute float aShape;
  attribute float aPhase;
  uniform float uScale;
  uniform float uTime;
  uniform float uTwinkle;
  uniform float uFacing; // 0..1: насколько гасить точки на обратной стороне (объём)
  varying vec3 vColor;
  varying float vAlpha;
  varying float vShape;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = aSize * uScale / -mv.z;
    float tw = 1.0 - uTwinkle + uTwinkle * (0.5 + 0.5 * sin(uTime * 1.6 + aPhase * 6.2831));
    vColor = aColor;
    vec3 wp = (modelMatrix * vec4(position, 1.0)).xyz;
    vec3 nrm = normalize((modelMatrix * vec4(position - vec3(0.0, -0.1, 0.0), 0.0)).xyz);
    float facing = dot(nrm, normalize(cameraPosition - wp));
    float fade = mix(1.0, 0.18 + 0.82 * smoothstep(-0.25, 0.55, facing), uFacing);
    vAlpha = aAlpha * tw * fade;
    vShape = aShape;
  }
`
const pointsFrag = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  varying float vShape;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    float a;
    vec3 col = vColor;
    if (vShape < -0.5) {
      a = smoothstep(0.5, 0.25, d);
    } else if (vShape < 0.5) {
      a = pow(smoothstep(0.5, 0.0, d), 1.7);
      col = mix(vColor, vec3(1.0), smoothstep(0.18, 0.0, d) * 0.6);
    } else {
      float core = smoothstep(0.11, 0.05, d);
      float edge = vShape < 1.5 ? abs(d - 0.3) : abs(max(abs(c.x), abs(c.y)) - 0.26);
      float ring = smoothstep(0.045, 0.0, edge);
      float glow = pow(smoothstep(0.5, 0.0, d), 3.0) * 0.7;
      a = max(max(core, ring), glow);
      col = mix(vColor, vec3(1.0), core);
    }
    float alpha = a * vAlpha;
    if (alpha < 0.004) discard;
    gl_FragColor = vec4(col, alpha);
  }
`

function makePoints(count: number, twinkle: number, facing = 0) {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3))
  g.setAttribute('aColor', new THREE.BufferAttribute(new Float32Array(count * 3), 3))
  g.setAttribute('aAlpha', new THREE.BufferAttribute(new Float32Array(count), 1))
  g.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(count), 1))
  g.setAttribute('aShape', new THREE.BufferAttribute(new Float32Array(count), 1))
  g.setAttribute('aPhase', new THREE.BufferAttribute(new Float32Array(count), 1))
  const m = new THREE.ShaderMaterial({
    vertexShader: pointsVert, fragmentShader: pointsFrag,
    uniforms: { uScale: { value: 400 }, uTime: { value: 0 }, uTwinkle: { value: twinkle }, uFacing: { value: facing } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  })
  return new THREE.Points(g, m)
}

const attr = (p: THREE.Points | THREE.LineSegments, name: string) =>
  p.geometry.getAttribute(name) as THREE.BufferAttribute

interface Nucleus { idx: number; kind: 'skill' | 'book'; title: string; xp: number }

function nucleiFor(achievements: Achievement[], lit: Record<ZoneKey, number>, m: Model): Nucleus[] {
  const out: Nucleus[] = []
  for (const z of ZONES) {
    const list = achievements.filter((a) => a.zone === z).sort((a, b) => a.date.localeCompare(b.date))
    const n0 = Math.floor(lit[z] ?? 0)
    if (!list.length || n0 < 1) continue
    const n = Math.min(list.length, n0)
    for (let k = 0; k < n; k++) {
      const rank = Math.min(n0 - 1, Math.floor(((k + 0.5) / n) * n0))
      out.push({ idx: m.byZone[z][rank], kind: list[k].kind, title: list[k].title, xp: list[k].xp })
    }
  }
  return out
}

export default function Brain3D(props: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const propsRef = useRef(props)
  propsRef.current = props
  const [tip, setTip] = useState<Tip | null>(null)
  const growKey = JSON.stringify([props.xp, props.fromXp])
  const achKey = JSON.stringify(props.achievements?.map((a) => [a.kind, a.title, a.zone, a.date]) ?? [])

  const stateRef = useRef({
    growStart: 0,
    from: {} as Record<ZoneKey, number>,
    to: {} as Record<ZoneKey, number>,
    notified: false,
    born: new Map<number, number>(),
    celebrateAt: -1,
    hoverZone: null as ZoneKey | null,
    achDirty: true,
  })

  useEffect(() => {
    const m = buildModel()
    const s = stateRef.current
    const { xp, fromXp, celebrate } = propsRef.current
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    for (const z of ZONES) {
      s.to[z] = litFor(z, xp[z] ?? 0, m)
      s.from[z] = reduce ? s.to[z] : litFor(z, fromXp?.[z] ?? 0, m)
    }
    s.growStart = performance.now() + 400
    s.notified = false
    s.born.clear()
    s.celebrateAt = celebrate && !reduce ? s.growStart + GROW_MS * 0.65 : -1
    s.achDirty = true
  }, [growKey]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { stateRef.current.achDirty = true }, [achKey])

  useEffect(() => {
    const wrap = wrapRef.current!
    const model = buildModel()
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const compact = !!propsRef.current.compact

    // ---------- Рендерер, сцена, камера ----------
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1))
    renderer.domElement.setAttribute('role', 'img')
    renderer.domElement.setAttribute('aria-label', 'Трёхмерная модель мозга: зоны светятся по мере накопления опыта')
    wrap.prepend(renderer.domElement)

    const scene = new THREE.Scene()
    scene.background = new THREE.Color('#04060e')
    const camera = new THREE.PerspectiveCamera(compact ? 34 : 36, 1, 0.1, 60)
    camera.position.set(-3.05, 0.7, 1.15).multiplyScalar(compact ? 1.12 : 1)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.target.set(0, -0.08, -0.05)
    controls.enableDamping = true
    controls.dampingFactor = 0.06
    controls.enablePan = false
    controls.enableZoom = !compact
    controls.minDistance = 2.2
    controls.maxDistance = 5
    controls.rotateSpeed = 0.6
    controls.autoRotate = !reduce
    controls.autoRotateSpeed = compact ? 0.9 : 0.6
    let resumeTimer = 0
    controls.addEventListener('start', () => { controls.autoRotate = false; window.clearTimeout(resumeTimer) })
    controls.addEventListener('end', () => {
      if (!reduce) resumeTimer = window.setTimeout(() => { controls.autoRotate = true }, 3500)
    })

    const brain = new THREE.Group()
    scene.add(brain)

    // ---------- Оболочка коры ----------
    const shellPts = makePoints(model.shell.length, 0.45, 1)
    {
      const pos = attr(shellPts, 'position'), ph = attr(shellPts, 'aPhase'), sz = attr(shellPts, 'aSize')
      model.shell.forEach((s, i) => {
        pos.setXYZ(i, s.p[0], s.p[1], s.p[2])
        ph.setX(i, s.n)
        sz.setX(i, s.zone === 'stem' ? 0.011 : 0.011 + s.n * 0.006)
        attr(shellPts, 'aShape').setX(i, -1)
      })
    }
    brain.add(shellPts)

    // ---------- Нейроны ----------
    const nPts = makePoints(model.neurons.length, 0.3, 0.55)
    {
      const pos = attr(nPts, 'position'), ph = attr(nPts, 'aPhase')
      model.neurons.forEach((n, i) => { pos.setXYZ(i, n.p[0], n.p[1], n.p[2]); ph.setX(i, n.phase / 6.283) })
    }
    brain.add(nPts)

    // ---------- Связи ----------
    const eGeo = new THREE.BufferGeometry()
    const ePos = new Float32Array(model.edges.length * 6)
    model.edges.forEach(([a, b], i) => {
      ePos.set(model.neurons[a].p, i * 6)
      ePos.set(model.neurons[b].p, i * 6 + 3)
    })
    eGeo.setAttribute('position', new THREE.BufferAttribute(ePos, 3))
    eGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(model.edges.length * 6), 3))
    const edges = new THREE.LineSegments(eGeo, new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    }))
    brain.add(edges)

    // ---------- Импульсы ----------
    const PULSES = 110
    const pulsePts = makePoints(PULSES, 0)
    brain.add(pulsePts)
    const pulses: { e: number; t: number; v: number; dir: number }[] = []

    // ---------- Ядра (навыки и книги) ----------
    const NUC_MAX = 120
    const nucPts = makePoints(NUC_MAX, 0, 0.4)
    brain.add(nucPts)
    let nuclei: Nucleus[] = []

    // ---------- Пыль вокруг ----------
    const DUST = compact ? 260 : 650
    const dust = makePoints(DUST, 0.8)
    {
      const pos = attr(dust, 'position'), col = attr(dust, 'aColor'), al = attr(dust, 'aAlpha'), sz = attr(dust, 'aSize'), ph = attr(dust, 'aPhase')
      let seed = 7
      const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
      for (let i = 0; i < DUST; i++) {
        const u = r() * 2 - 1, t = r() * Math.PI * 2, rad = 1.8 + r() * 3.2, s = Math.sqrt(1 - u * u)
        pos.setXYZ(i, s * Math.cos(t) * rad, u * rad * 0.7, s * Math.sin(t) * rad)
        const c = new THREE.Color(r() < 0.5 ? '#6f7dff' : '#38e1ff')
        col.setXYZ(i, c.r, c.g, c.b)
        al.setX(i, 0.08 + r() * 0.18)
        sz.setX(i, 0.02 + r() * 0.03)
        ph.setX(i, r())
      }
    }
    scene.add(dust)

    // ---------- Волна «новый уровень» ----------
    const rings = [0, 1, 2].map(() => {
      const mesh = new THREE.Mesh(
        new THREE.RingGeometry(0.97, 1, 128),
        new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
      )
      scene.add(mesh)
      return mesh
    })

    // ---------- Постобработка: свечение ----------
    const composer = new EffectComposer(renderer)
    composer.addPass(new RenderPass(scene, camera))
    const BLOOM = compact ? 0.7 : 0.85
    const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), BLOOM, 0.5, 0.1)
    composer.addPass(bloom)
    composer.addPass(new OutputPass())

    // ---------- Размер ----------
    let width = 1, height = 1
    const resize = () => {
      width = wrap.clientWidth
      height = compact ? Math.round(Math.min(260, width * 0.72)) : Math.round(Math.max(340, Math.min(560, width * 0.66)))
      renderer.setSize(width, height)
      composer.setSize(width, height)
      bloom.setSize(width, height)
      camera.aspect = width / height
      // На узких экранах расширяем угол обзора, чтобы мозг помещался целиком
      const baseFov = compact ? 34 : 36
      camera.fov = camera.aspect < 1.45 ? baseFov * Math.min(1.45, Math.pow(1.45 / camera.aspect, 0.6)) : baseFov
      camera.updateProjectionMatrix()
      const scale = (height * renderer.getPixelRatio()) / (2 * Math.tan((camera.fov * Math.PI) / 360))
      for (const p of [shellPts, nPts, pulsePts, nucPts, dust]) (p.material as THREE.ShaderMaterial).uniforms.uScale.value = scale
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(wrap)
    let visible = true
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting })
    io.observe(wrap)

    // ---------- Цвета ----------
    const zoneColor = Object.fromEntries(ZONES.map((z) => [z, new THREE.Color(ZONE_HEX[z])])) as Record<ZoneKey, THREE.Color>
    const base = new THREE.Color('#3a4bb0')
    const tmp = new THREE.Color()
    let shellSig = ''

    const updateShell = (frac: Record<ZoneKey, number>, hl: ZoneKey | null) => {
      const sig = ZONES.map((z) => frac[z].toFixed(3)).join() + hl
      if (sig === shellSig) return
      shellSig = sig
      const col = attr(shellPts, 'aColor'), al = attr(shellPts, 'aAlpha')
      model.shell.forEach((s, i) => {
        if (s.zone === 'stem') {
          col.setXYZ(i, base.r * 0.8, base.g * 0.8, base.b * 0.9)
          al.setX(i, hl ? 0.06 : 0.12)
          return
        }
        const f = frac[s.zone]
        const tint = Math.min(1, f * 1.15) * (0.55 + 0.45 * s.n)
        tmp.copy(base).lerp(zoneColor[s.zone], tint)
        const dim = hl && hl !== s.zone ? 0.3 : hl === s.zone ? 1.5 : 1
        col.setXYZ(i, tmp.r, tmp.g, tmp.b)
        al.setX(i, Math.min(1, (0.2 + 0.32 * f) * dim * (0.25 + 0.95 * s.fold)))
      })
      col.needsUpdate = true
      al.needsUpdate = true
    }

    // ---------- Наведение ----------
    const raycaster = new THREE.Raycaster()
    const ndc = new THREE.Vector2()
    let pointer: { x: number; y: number } | null = null
    const onMove = (e: PointerEvent) => {
      const r = renderer.domElement.getBoundingClientRect()
      pointer = { x: e.clientX - r.left, y: e.clientY - r.top }
    }
    const onLeave = () => {
      pointer = null
      setTip(null)
      if (stateRef.current.hoverZone) {
        stateRef.current.hoverZone = null
        propsRef.current.onHoverZone?.(null)
      }
    }
    renderer.domElement.addEventListener('pointermove', onMove)
    renderer.domElement.addEventListener('pointerleave', onLeave)
    let lastPick = 0
    const pick = (now: number) => {
      if (!pointer || now - lastPick < 60) return
      lastPick = now
      ndc.set((pointer.x / width) * 2 - 1, -(pointer.y / height) * 2 + 1)
      raycaster.setFromCamera(ndc, camera)
      const p = propsRef.current
      raycaster.params.Points = { threshold: 0.06 }
      const hitN = nuclei.length ? raycaster.intersectObject(nucPts).find((h) => (h.index ?? 999) < nuclei.length) : undefined
      raycaster.params.Points = { threshold: 0.035 }
      const hitS = raycaster.intersectObject(shellPts)[0]
      const sh = hitS?.index !== undefined ? model.shell[hitS.index] : undefined
      const zone = sh && sh.zone !== 'stem' ? sh.zone : null
      if (zone !== stateRef.current.hoverZone) {
        stateRef.current.hoverZone = zone
        p.onHoverZone?.(zone)
      }
      if (hitN && hitN.index !== undefined) {
        const nc = nuclei[hitN.index]
        const z = model.neurons[nc.idx].zone
        setTip({ x: pointer.x, y: pointer.y, color: ZONE_HEX[z], title: nc.title,
          sub: `${nc.kind === 'book' ? 'Прочитанная книга' : 'Изученный навык'} · +${nc.xp} XP` })
      } else if (zone && p.zoneMeta?.[zone]) {
        const mz = p.zoneMeta[zone]!
        setTip({ x: pointer.x, y: pointer.y, color: ZONE_HEX[zone], title: `${mz.name} · ур. ${mz.level}`, sub: `${mz.desc} · ${mz.xp} XP` })
      } else {
        setTip(null)
      }
    }

    // ---------- Кадр ----------
    let raf = 0
    const clock = new THREE.Clock()
    const frame = () => {
      raf = requestAnimationFrame(frame)
      if (!visible) return
      const now = performance.now()
      const time = clock.getElapsedTime()
      const s = stateRef.current
      const p = propsRef.current
      const hl = p.highlight ?? s.hoverZone
      const g = reduce ? 1 : easeOut(clamp01((now - s.growStart) / GROW_MS))
      if (g >= 1 && !s.notified) { s.notified = true; p.onGrown?.() }

      const lit = {} as Record<ZoneKey, number>
      const frac = {} as Record<ZoneKey, number>
      for (const z of ZONES) {
        lit[z] = s.from[z] + (s.to[z] - s.from[z]) * g
        frac[z] = lit[z] / Math.max(1, model.byZone[z].length)
      }
      updateShell(frac, hl)

      // Нейроны
      const bright = model.neurons.map((n) => clamp01(lit[n.zone] - n.rank))
      {
        const col = attr(nPts, 'aColor'), al = attr(nPts, 'aAlpha'), sz = attr(nPts, 'aSize')
        model.neurons.forEach((n, i) => {
          const b = bright[i]
          if (b > 0 && g < 1 && !s.born.has(i) && n.rank >= s.from[n.zone]) s.born.set(i, now)
          const born = s.born.get(i)
          const age = born ? (now - born) / 900 : 9
          const flash = age < 1 ? 1 - age : 0
          const dim = hl && hl !== n.zone ? 0.25 : 1
          if (b <= 0) {
            col.setXYZ(i, 0.45, 0.5, 0.95)
            al.setX(i, 0.22 * dim)
            sz.setX(i, 0.028)
          } else {
            const c = zoneColor[n.zone]
            col.setXYZ(i, c.r + flash * 0.6, c.g + flash * 0.6, c.b + flash * 0.6)
            al.setX(i, (0.3 + 0.5 * b) * dim)
            sz.setX(i, (0.045 + 0.03 * b) * (1 + 2.2 * flash))
          }
        })
        col.needsUpdate = al.needsUpdate = sz.needsUpdate = true
      }

      // Связи
      const litEdges: number[] = []
      {
        const col = eGeo.getAttribute('color') as THREE.BufferAttribute
        model.edges.forEach(([a, b], i) => {
          const on = Math.min(bright[a], bright[b])
          const za = model.neurons[a].zone, zb = model.neurons[b].zone
          const dim = hl && hl !== za && hl !== zb ? 0.2 : 1
          if (on >= 1) litEdges.push(i)
          if (on > 0) {
            const ca = zoneColor[za], cb = zoneColor[zb]
            const k = (0.12 + 0.3 * on) * dim
            col.setXYZ(i * 2, ca.r * k, ca.g * k, ca.b * k)
            col.setXYZ(i * 2 + 1, cb.r * k, cb.g * k, cb.b * k)
          } else {
            const k = 0.07 * dim
            col.setXYZ(i * 2, 0.4 * k, 0.45 * k, 1 * k)
            col.setXYZ(i * 2 + 1, 0.4 * k, 0.45 * k, 1 * k)
          }
        })
        col.needsUpdate = true
      }

      // Импульсы
      {
        if (!reduce && litEdges.length) {
          const want = Math.min(PULSES, 6 + litEdges.length * 0.4)
          if (pulses.length < want && Math.random() < 0.25 + litEdges.length / 400) {
            pulses.push({ e: litEdges[(Math.random() * litEdges.length) | 0], t: 0, v: 0.012 + Math.random() * 0.022, dir: Math.random() < 0.5 ? 1 : -1 })
          }
        }
        const pos = attr(pulsePts, 'position'), col = attr(pulsePts, 'aColor'), al = attr(pulsePts, 'aAlpha'), sz = attr(pulsePts, 'aSize')
        for (let i = pulses.length - 1; i >= 0; i--) {
          pulses[i].t += pulses[i].v
          if (pulses[i].t >= 1) pulses.splice(i, 1)
        }
        for (let i = 0; i < PULSES; i++) {
          const pl = pulses[i]
          if (!pl) { al.setX(i, 0); continue }
          const [a0, b0] = model.edges[pl.e]
          const [a, b] = pl.dir === 1 ? [a0, b0] : [b0, a0]
          const pa = model.neurons[a].p, pb = model.neurons[b].p
          pos.setXYZ(i, pa[0] + (pb[0] - pa[0]) * pl.t, pa[1] + (pb[1] - pa[1]) * pl.t, pa[2] + (pb[2] - pa[2]) * pl.t)
          const c = zoneColor[model.neurons[a].zone]
          col.setXYZ(i, c.r * 0.6 + 0.4, c.g * 0.6 + 0.4, c.b * 0.6 + 0.4)
          const dim = hl && hl !== model.neurons[a].zone ? 0.25 : 1
          al.setX(i, Math.sin(pl.t * Math.PI) * dim)
          sz.setX(i, 0.055)
        }
        pos.needsUpdate = col.needsUpdate = al.needsUpdate = sz.needsUpdate = true
      }

      // Ядра
      if (s.achDirty) {
        nuclei = nucleiFor(p.achievements ?? [], s.to, model).slice(0, NUC_MAX)
        s.achDirty = false
        const pos = attr(nucPts, 'position'), col = attr(nucPts, 'aColor'), shp = attr(nucPts, 'aShape'), ph = attr(nucPts, 'aPhase')
        nuclei.forEach((nc, i) => {
          const n = model.neurons[nc.idx]
          pos.setXYZ(i, n.p[0], n.p[1], n.p[2])
          const c = zoneColor[n.zone]
          col.setXYZ(i, c.r, c.g, c.b)
          shp.setX(i, nc.kind === 'book' ? 2 : 1)
          ph.setX(i, n.phase)
        })
        pos.needsUpdate = col.needsUpdate = shp.needsUpdate = ph.needsUpdate = true
      }
      {
        const al = attr(nucPts, 'aAlpha'), sz = attr(nucPts, 'aSize')
        for (let i = 0; i < NUC_MAX; i++) {
          const nc = nuclei[i]
          if (!nc) { al.setX(i, 0); continue }
          const n = model.neurons[nc.idx]
          const dim = hl && hl !== n.zone ? 0.25 : 1
          al.setX(i, bright[nc.idx] >= 1 ? dim : 0)
          sz.setX(i, 0.17 + 0.025 * Math.sin(time * 2 + n.phase))
        }
        al.needsUpdate = sz.needsUpdate = true
      }

      // Волна нового уровня
      rings.forEach((ring, k) => {
        const mat = ring.material as THREE.MeshBasicMaterial
        if (s.celebrateAt < 0 || now < s.celebrateAt) { mat.opacity = 0; return }
        const tt = (now - s.celebrateAt) / 2000 - k * 0.14
        if (tt <= 0 || tt >= 1) { mat.opacity = 0; return }
        ring.position.copy(controls.target)
        ring.quaternion.copy(camera.quaternion)
        const sc = 0.6 + easeOut(tt) * 2.6
        ring.scale.setScalar(sc)
        mat.opacity = (1 - tt) * 0.85
      })
      if (s.celebrateAt > 0 && now > s.celebrateAt && now < s.celebrateAt + 900) {
        bloom.strength = BLOOM + 0.9 * (1 - (now - s.celebrateAt) / 900)
      } else {
        bloom.strength = BLOOM
      }

      // Дыхание и пыль
      const breath = 1 + 0.008 * Math.sin(time * 1.3)
      brain.scale.setScalar(breath)
      dust.rotation.y = time * 0.02
      for (const pt of [shellPts, nPts, nucPts, dust]) (pt.material as THREE.ShaderMaterial).uniforms.uTime.value = time

      controls.update()
      pick(now)
      composer.render()
    }
    raf = requestAnimationFrame(frame)

    return () => {
      cancelAnimationFrame(raf)
      window.clearTimeout(resumeTimer)
      ro.disconnect()
      io.disconnect()
      renderer.domElement.removeEventListener('pointermove', onMove)
      renderer.domElement.removeEventListener('pointerleave', onLeave)
      controls.dispose()
      scene.traverse((o) => {
        const anyO = o as THREE.Mesh
        anyO.geometry?.dispose()
        const mat = anyO.material as THREE.Material | THREE.Material[] | undefined
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose()); else mat?.dispose()
      })
      composer.dispose()
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [])

  return (
    <div ref={wrapRef} className={`brain3d ${props.compact ? 'compact' : ''}`}>
      {tip && (
        <div className="brain-tip" style={{ left: tip.x, top: tip.y, borderColor: tip.color }}>
          <div className="brain-tip-title">{tip.title}</div>
          {tip.sub && <div className="brain-tip-sub">{tip.sub}</div>}
        </div>
      )}
      {!props.compact && (
        <div className="brain3d-hint">
          {window.matchMedia('(pointer: coarse)').matches ? 'Проведи пальцем, чтобы вращать' : 'Перетащи, чтобы вращать · колесо — приблизить'}
        </div>
      )}
    </div>
  )
}
