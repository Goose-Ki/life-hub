import { useEffect, useRef, useState } from 'react'
import { Achievement, ZoneKey } from '../../api'
import {
  BOUNDARIES, buildNetwork, litFor, Network, SULCI, VIEW_H, VIEW_W, ZONE_COLORS, ZONE_ORDER, zoneOf,
} from './geometry'

export type ZoneXP = Record<ZoneKey, number>
export interface ZoneMeta { name: string; desc: string; level: number; xp: number }

interface Props {
  xp: ZoneXP                         // текущий опыт по зонам
  fromXp?: ZoneXP                    // с какого состояния анимировать рост
  achievements?: Achievement[]       // навыки и книги — крупные «ядра»
  zoneMeta?: Partial<Record<ZoneKey, ZoneMeta>>
  highlight?: ZoneKey | null         // подсветить зону (наведение в списке)
  celebrate?: boolean                // волна «новый уровень»
  compact?: boolean
  onHoverZone?: (z: ZoneKey | null) => void
  onGrown?: () => void               // анимация роста закончилась
}

interface Pulse { edge: number; t: number; speed: number; dir: 1 | -1 }
interface Tip { x: number; y: number; title: string; sub?: string; color: string }

const GROW_MS = 2600
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3)
const clamp01 = (v: number) => Math.max(0, Math.min(1, v))

function haloSprite(color: string) {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')!
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  grd.addColorStop(0, color + 'cc')
  grd.addColorStop(0.35, color + '44')
  grd.addColorStop(1, color + '00')
  g.fillStyle = grd
  g.fillRect(0, 0, 64, 64)
  return c
}

export function BrainCanvas(props: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const propsRef = useRef(props)
  propsRef.current = props
  const [tip, setTip] = useState<Tip | null>(null)
  const hoverZoneRef = useRef<ZoneKey | null>(null)
  // Ключ анимации роста: меняется при новых данных — рост перезапускается.
  const growKey = JSON.stringify([props.xp, props.fromXp])

  const stateRef = useRef({
    growStart: 0,
    from: {} as Record<ZoneKey, number>,
    to: {} as Record<ZoneKey, number>,
    grownNotified: false,
    born: new Map<number, number>(),
    pulses: [] as Pulse[],
    celebrateAt: -1,
  })

  // Перезапуск роста при новых данных
  useEffect(() => {
    const net = buildNetwork()
    const s = stateRef.current
    const { xp, fromXp, celebrate } = propsRef.current
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    for (const z of ZONE_ORDER) {
      s.to[z] = litFor(z, xp[z] ?? 0, net)
      s.from[z] = reduce ? s.to[z] : litFor(z, fromXp?.[z] ?? 0, net)
    }
    s.growStart = performance.now() + 250
    s.grownNotified = false
    s.born.clear()
    s.celebrateAt = celebrate && !reduce ? s.growStart + GROW_MS * 0.6 : -1
  }, [growKey]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const canvas = canvasRef.current!
    const wrap = wrapRef.current!
    const ctx = canvas.getContext('2d')!
    const net: Network = buildNetwork()
    const sprites = Object.fromEntries(ZONE_ORDER.map((z) => [z, haloSprite(ZONE_COLORS[z])])) as Record<ZoneKey, HTMLCanvasElement>
    const whiteSprite = haloSprite('#ffffff')
    const sulci = SULCI.map((d) => new Path2D(d))
    const bounds = BOUNDARIES.map((d) => new Path2D(d))
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let raf = 0
    let scale = 1
    let visible = true

    const resize = () => {
      const w = wrap.clientWidth
      const h = Math.round((w * VIEW_H) / VIEW_W)
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      canvas.style.height = `${h}px`
      scale = (w / VIEW_W) * dpr
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(wrap)
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting })
    io.observe(canvas)

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame)
      if (!visible) return
      const s = stateRef.current
      const p = propsRef.current
      const hl = p.highlight ?? hoverZoneRef.current
      const g = reduce ? 1 : easeOut(clamp01((now - s.growStart) / GROW_MS))
      if (g >= 1 && !s.grownNotified) {
        s.grownNotified = true
        p.onGrown?.()
      }
      const lit: Record<ZoneKey, number> = {} as Record<ZoneKey, number>
      for (const z of ZONE_ORDER) lit[z] = s.from[z] + (s.to[z] - s.from[z]) * g
      const bright = net.neurons.map((n) => clamp01(lit[n.zone] - n.rank))
      bright.forEach((b, i) => {
        if (b > 0 && !s.born.has(i) && g < 1 && net.neurons[i].rank >= s.from[net.neurons[i].zone]) s.born.set(i, now)
      })
      const time = now / 1000

      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.setTransform(scale, 0, 0, scale, 0, 0)

      // Фон сцены — CSS-градиент контейнера (canvas прозрачный)

      // Силуэт
      const breath = 0.5 + 0.5 * Math.sin(time * 1.2)
      ctx.save()
      ctx.fillStyle = '#0f1530'
      ctx.fill(net.stem)
      const body = ctx.createLinearGradient(0, 40, 0, 380)
      body.addColorStop(0, '#182046')
      body.addColorStop(1, '#0e1430')
      ctx.fillStyle = body
      ctx.fill(net.cerebrum)
      ctx.fill(net.cerebellum)
      ctx.shadowColor = '#7c8cff'
      ctx.shadowBlur = 14 + breath * 10
      ctx.strokeStyle = `rgba(150,165,255,${0.35 + breath * 0.15})`
      ctx.lineWidth = 2
      ctx.stroke(net.cerebrum)
      ctx.stroke(net.cerebellum)
      ctx.shadowBlur = 0
      ctx.strokeStyle = 'rgba(150,165,255,0.18)'
      ctx.lineWidth = 1.5
      ctx.stroke(net.stem)
      ctx.restore()

      // Извилины и границы долей — внутри силуэта
      ctx.save()
      const clip = new Path2D()
      clip.addPath(net.cerebrum)
      clip.addPath(net.cerebellum)
      ctx.clip(clip)
      ctx.lineCap = 'round'
      ctx.strokeStyle = 'rgba(190,200,255,0.1)'
      ctx.lineWidth = 2.2
      sulci.forEach((s2) => ctx.stroke(s2))
      ctx.setLineDash([3, 6])
      ctx.strokeStyle = 'rgba(190,200,255,0.12)'
      ctx.lineWidth = 1
      bounds.forEach((b) => ctx.stroke(b))
      ctx.setLineDash([])

      // Свечение зон
      ctx.globalCompositeOperation = 'lighter'
      net.neurons.forEach((n, i) => {
        const b = bright[i]
        if (b <= 0) return
        const dim = hl && hl !== n.zone ? 0.25 : hl === n.zone ? 1.6 : 1
        const flick = 0.75 + 0.25 * Math.sin(time * 1.7 + n.phase)
        ctx.globalAlpha = Math.min(1, 0.22 * b * flick * dim)
        const r = 34
        ctx.drawImage(sprites[n.zone], n.x - r, n.y - r, r * 2, r * 2)
      })
      ctx.globalAlpha = 1
      ctx.restore()

      // Связи
      ctx.save()
      ctx.lineWidth = 0.9
      const litEdges: number[] = []
      net.edges.forEach((e, ei) => {
        const a = net.neurons[e.a], b = net.neurons[e.b]
        const ba = bright[e.a], bb = bright[e.b]
        const on = Math.min(ba, bb)
        if (on >= 1) litEdges.push(ei)
        ctx.beginPath()
        ctx.moveTo(a.x, a.y)
        ctx.lineTo(b.x, b.y)
        if (on > 0) {
          const dim = hl && hl !== a.zone && hl !== b.zone ? 0.3 : 1
          ctx.strokeStyle = ZONE_COLORS[a.zone]
          ctx.globalAlpha = (0.12 + 0.3 * on) * dim
        } else {
          ctx.strokeStyle = '#c8d0ff'
          ctx.globalAlpha = 0.05
        }
        ctx.stroke()
      })
      ctx.globalAlpha = 1
      ctx.restore()

      // Импульсы по связям
      if (!reduce && litEdges.length) {
        const maxPulses = Math.min(70, 4 + litEdges.length / 3)
        if (s.pulses.length < maxPulses && Math.random() < 0.05 + litEdges.length / 900) {
          s.pulses.push({
            edge: litEdges[(Math.random() * litEdges.length) | 0], t: 0,
            speed: 0.012 + Math.random() * 0.02, dir: Math.random() < 0.5 ? 1 : -1,
          })
        }
        ctx.save()
        ctx.globalCompositeOperation = 'lighter'
        s.pulses = s.pulses.filter((pl) => {
          pl.t += pl.speed
          if (pl.t >= 1) return false
          const e = net.edges[pl.edge]
          const a = net.neurons[pl.dir === 1 ? e.a : e.b], b = net.neurons[pl.dir === 1 ? e.b : e.a]
          const x = a.x + (b.x - a.x) * pl.t, y = a.y + (b.y - a.y) * pl.t
          const fade = Math.sin(pl.t * Math.PI)
          const dim = hl && hl !== a.zone ? 0.3 : 1
          ctx.globalAlpha = 0.9 * fade * dim
          ctx.drawImage(sprites[a.zone], x - 9, y - 9, 18, 18)
          ctx.globalAlpha = fade * dim
          ctx.fillStyle = '#ffffff'
          ctx.beginPath()
          ctx.arc(x, y, 1.3, 0, Math.PI * 2)
          ctx.fill()
          return true
        })
        ctx.restore()
      }

      // Нейроны
      net.neurons.forEach((n, i) => {
        const b = bright[i]
        const dim = hl && hl !== n.zone ? 0.35 : 1
        if (b <= 0) {
          ctx.globalAlpha = 0.16 * dim
          ctx.fillStyle = '#c8d0ff'
          ctx.beginPath()
          ctx.arc(n.x, n.y, 1.5, 0, Math.PI * 2)
          ctx.fill()
          return
        }
        const born = s.born.get(i)
        const age = born ? (now - born) / 700 : 99
        const pop = age < 1 ? 1 + 1.4 * (1 - age) : 1
        const twinkle = 0.8 + 0.2 * Math.sin(time * 2.3 + n.phase * 3)
        ctx.globalAlpha = (0.35 + 0.65 * b) * dim
        ctx.fillStyle = ZONE_COLORS[n.zone]
        ctx.beginPath()
        ctx.arc(n.x, n.y, (1.6 + 1.3 * b) * pop, 0, Math.PI * 2)
        ctx.fill()
        ctx.globalAlpha = b * twinkle * dim
        ctx.fillStyle = '#ffffff'
        ctx.beginPath()
        ctx.arc(n.x, n.y, 0.9 * b, 0, Math.PI * 2)
        ctx.fill()
        if (age < 1) {
          ctx.globalAlpha = (1 - age) * 0.8
          ctx.strokeStyle = ZONE_COLORS[n.zone]
          ctx.lineWidth = 1.2
          ctx.beginPath()
          ctx.arc(n.x, n.y, 3 + age * 14, 0, Math.PI * 2)
          ctx.stroke()
        }
      })
      ctx.globalAlpha = 1

      // Ядра: изученные навыки и прочитанные книги
      const nuclei = nucleiFor(p.achievements ?? [], s.to, net)
      nuclei.forEach((nc) => {
        const n = net.neurons[nc.idx]
        const b = bright[nc.idx]
        if (b < 1) return
        const dim = hl && hl !== n.zone ? 0.35 : 1
        const pulse = 0.5 + 0.5 * Math.sin(time * 2 + n.phase)
        ctx.save()
        ctx.globalCompositeOperation = 'lighter'
        ctx.globalAlpha = (0.55 + 0.3 * pulse) * dim
        ctx.drawImage(sprites[n.zone], n.x - 22, n.y - 22, 44, 44)
        ctx.globalAlpha = 0.35 * dim
        ctx.drawImage(whiteSprite, n.x - 10, n.y - 10, 20, 20)
        ctx.restore()
        ctx.globalAlpha = dim
        ctx.fillStyle = '#ffffff'
        ctx.beginPath()
        ctx.arc(n.x, n.y, 3.2, 0, Math.PI * 2)
        ctx.fill()
        ctx.strokeStyle = ZONE_COLORS[n.zone]
        ctx.lineWidth = 1.6
        ctx.beginPath()
        if (nc.kind === 'book') ctx.rect(n.x - 6, n.y - 6, 12, 12)
        else ctx.arc(n.x, n.y, 6.5, 0, Math.PI * 2)
        ctx.stroke()
        ctx.globalAlpha = 1
      })

      // Волна «новый уровень»
      if (s.celebrateAt > 0 && now > s.celebrateAt) {
        const k = (now - s.celebrateAt) / 1800
        if (k < 1) {
          ctx.save()
          ctx.globalCompositeOperation = 'lighter'
          for (let ring = 0; ring < 3; ring++) {
            const kk = k - ring * 0.12
            if (kk <= 0) continue
            ctx.globalAlpha = (1 - kk) * 0.6
            ctx.strokeStyle = '#ffffff'
            ctx.lineWidth = 2.5 * (1 - kk) + 0.5
            ctx.beginPath()
            ctx.ellipse(300, 200, 40 + kk * 300, 30 + kk * 220, 0, 0, Math.PI * 2)
            ctx.stroke()
          }
          ctx.restore()
        }
      }
    }
    raf = requestAnimationFrame(frame)
    return () => { cancelAnimationFrame(raf); ro.disconnect(); io.disconnect() }
  }, [])

  // Наведение: ядро (навык/книга) или зона
  const onMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const net = buildNetwork()
    const rect = e.currentTarget.getBoundingClientRect()
    const k = VIEW_W / rect.width
    const x = (e.clientX - rect.left) * k, y = (e.clientY - rect.top) * k
    const p = propsRef.current
    const nuclei = nucleiFor(p.achievements ?? [], stateRef.current.to, net)
    const hit = nuclei.find((nc) => Math.hypot(net.neurons[nc.idx].x - x, net.neurons[nc.idx].y - y) < 11)
    const ctx = e.currentTarget.getContext('2d')!
    const inCb = ctx.isPointInPath(net.cerebellum, x, y)
    const inBrain = inCb || ctx.isPointInPath(net.cerebrum, x, y)
    const zone = inBrain ? zoneOf(x, y, inCb) : null
    if (zone !== hoverZoneRef.current) {
      hoverZoneRef.current = zone
      p.onHoverZone?.(zone)
    }
    const px = e.clientX - rect.left, py = e.clientY - rect.top
    if (hit) {
      const n = net.neurons[hit.idx]
      setTip({ x: px, y: py, color: ZONE_COLORS[n.zone], title: hit.title,
        sub: `${hit.kind === 'book' ? 'Прочитанная книга' : 'Изученный навык'} · +${hit.xp} XP` })
    } else if (zone && p.zoneMeta?.[zone]) {
      const m = p.zoneMeta[zone]!
      setTip({ x: px, y: py, color: ZONE_COLORS[zone], title: `${m.name} · ур. ${m.level}`, sub: `${m.desc} · ${m.xp} XP` })
    } else {
      setTip(null)
    }
  }
  const onLeave = () => {
    setTip(null)
    hoverZoneRef.current = null
    propsRef.current.onHoverZone?.(null)
  }

  return (
    <div ref={wrapRef} className={`brain-canvas ${props.compact ? 'compact' : ''}`}>
      <canvas ref={canvasRef} onMouseMove={onMove} onMouseLeave={onLeave} role="img"
        aria-label="Визуализация развития мозга: зоны светятся по мере накопления опыта" />
      {tip && (
        <div className="brain-tip" style={{ left: tip.x, top: tip.y, borderColor: tip.color }}>
          <div className="brain-tip-title">{tip.title}</div>
          {tip.sub && <div className="brain-tip-sub">{tip.sub}</div>}
        </div>
      )}
    </div>
  )
}

interface Nucleus { idx: number; kind: 'skill' | 'book'; title: string; xp: number }

// Навыки и книги закрепляются за горящими нейронами своей зоны, равномерно от ядра к краю.
function nucleiFor(achievements: Achievement[], litTarget: Record<ZoneKey, number>, net: Network): Nucleus[] {
  const out: Nucleus[] = []
  for (const z of ZONE_ORDER) {
    const list = achievements.filter((a) => a.zone === z).sort((a, b) => a.date.localeCompare(b.date))
    const lit = Math.floor(litTarget[z] ?? 0)
    if (!list.length || lit < 1) continue
    const n = Math.min(list.length, lit)
    for (let k = 0; k < n; k++) {
      const rank = Math.min(lit - 1, Math.floor(((k + 0.5) / n) * lit))
      out.push({ idx: net.byZone[z][rank], kind: list[k].kind, title: list[k].title, xp: list[k].xp })
    }
  }
  return out
}
