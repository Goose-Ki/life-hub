// Процедурная 3D-модель мозга: оболочка коры (облако точек), мозжечок, ствол,
// нейроны по зонам и связи между ними. Генерируется один раз, детерминированно.
// Оси: x — лево/право, y — вверх, z — вперёд (лоб).
import { ZoneKey } from '../../api'

export type Vec3 = [number, number, number]

export const ZONES: ZoneKey[] = ['frontal', 'parietal', 'temporal', 'occipital', 'cerebellum']

export const ZONE_HEX: Record<ZoneKey, string> = {
  frontal: '#ffb347',
  parietal: '#38e1ff',
  temporal: '#b49cff',
  occipital: '#ff6fb5',
  cerebellum: '#3ff0a8',
}

function mulberry32(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Извилины: гладкий «шум» из произведений синусов.
function gyri(x: number, y: number, z: number) {
  return (
    Math.sin(7.1 * x + 1.3 * Math.sin(5.0 * y)) *
    Math.sin(6.3 * y + 1.7 * Math.sin(4.7 * z)) *
    Math.sin(5.9 * z + 1.1 * Math.sin(6.1 * x))
  )
}

// Точка поверхности полушарий в направлении d (единичный вектор), depth — 1 = кора, <1 — глубже.
export function cortexPoint(d: Vec3, depth = 1): Vec3 {
  const [dx, dy, dz] = d
  const rx = 0.72, ry = 0.7, rz = 0.98
  let r = 1 / Math.sqrt((dx / rx) ** 2 + (dy / ry) ** 2 + (dz / rz) ** 2)
  let x = dx * r, y = dy * r, z = dz * r
  // Затылок уже, лоб чуть ниже
  x *= 1 - 0.18 * Math.max(0, -z - 0.35)
  if (z > 0.55) y -= 0.08 * (z - 0.55)
  // Плоское основание, височные доли выпирают вбок и вниз
  if (y < -0.26) y = -0.26 + (y + 0.26) * 0.6
  if (y < 0.05 && z > -0.35 && z < 0.55) x *= 1.07
  // Сильвиева борозда на боковой поверхности
  const sylv = y - (-0.02 + 0.28 * (z - 0.05))
  if (Math.abs(x) > 0.36 && Math.abs(sylv) < 0.07 && z > -0.4 && z < 0.62) {
    const k = 1 - Math.abs(sylv) / 0.07
    x *= 1 - 0.13 * k * k
    y -= 0.02 * k
  }
  // Лобный и затылочный полюса чуть заострены
  if (z > 0.7) y -= 0.05 * (z - 0.7)
  if (z < -0.75) y += 0.04 * (-z - 0.75)
  // Межполушарная щель
  x += Math.sign(x || 1) * 0.03
  if (Math.abs(x) < 0.16 && y > 0) y -= 0.1 * (1 - Math.abs(x) / 0.16) ** 2
  // Извилины
  const g = 1 + 0.04 * gyri(x * 1.25, y * 1.25, z * 1.25)
  r = g * depth
  return [x * r, y * r, z * r]
}

const CB_C: Vec3 = [0, -0.4, -0.66]
export function cerebellumPoint(d: Vec3, depth = 1): Vec3 {
  const [dx, dy, dz] = d
  const rx = 0.5, ry = 0.24, rz = 0.3
  const r = 1 / Math.sqrt((dx / rx) ** 2 + (dy / ry) ** 2 + (dz / rz) ** 2)
  let x = dx * r, y = dy * r, z = dz * r
  x += Math.sign(x || 1) * 0.015
  const g = (1 + 0.05 * Math.sin(y * 60 + z * 8)) * depth
  x *= g; y *= g; z *= g
  return [CB_C[0] + x, CB_C[1] + y, CB_C[2] + z]
}

// Рисунок извилин на поверхности: гребни ярче, борозды темнее.
function foldAt([x, y, z]: Vec3) {
  const g = gyri(x * 2.1 + 0.3, y * 2.1, z * 2.1 - 0.2)
  return Math.min(1, Math.max(0, 0.5 + 0.9 * g))
}

export function zoneOf([x, y, z]: Vec3): ZoneKey {
  if (y < -0.08 && z > -0.42 && z < 0.62 && Math.abs(x) > 0.25) return 'temporal'
  if (z > 0.28) return 'frontal'
  if (z < -0.5) return 'occipital'
  return 'parietal'
}

// Ядро зоны: отсюда загораются нейроны (по |x| — оба полушария растут одновременно).
const CORE: Record<ZoneKey, Vec3> = {
  frontal: [0.35, 0.25, 0.75], parietal: [0.3, 0.45, -0.15], temporal: [0.7, -0.2, 0.15],
  occipital: [0.3, 0.15, -0.85], cerebellum: [0.25, -0.4, -0.72],
}
const CAP: Record<ZoneKey, number> = { frontal: 90, parietal: 100, temporal: 76, occipital: 64, cerebellum: 56 }

export interface Neuron { p: Vec3; zone: ZoneKey; rank: number; phase: number }
export interface Model {
  shell: { p: Vec3; zone: ZoneKey | 'stem'; n: number; fold: number }[] // n — для мерцания, fold — гребень извилины 0..1
  neurons: Neuron[]
  byZone: Record<ZoneKey, number[]>
  edges: [number, number][]
}

let cached: Model | null = null

export function buildModel(): Model {
  if (cached) return cached
  const rand = mulberry32(1210_2006)
  const randDir = (): Vec3 => {
    const u = rand() * 2 - 1, t = rand() * Math.PI * 2, s = Math.sqrt(1 - u * u)
    return [s * Math.cos(t), u, s * Math.sin(t)]
  }

  // Оболочка коры — равномерно по сфере Фибоначчи
  const shell: Model['shell'] = []
  const N = 9000
  const golden = Math.PI * (3 - Math.sqrt(5))
  for (let i = 0; i < N; i++) {
    const y = 1 - (i / (N - 1)) * 2
    const rr = Math.sqrt(1 - y * y)
    const th = golden * i
    const p = cortexPoint([Math.cos(th) * rr, y, Math.sin(th) * rr], 1 + (rand() - 0.5) * 0.012)
    // не рисуем точки, утонувшие в мозжечке
    if (p[1] < -0.3 && p[2] < -0.45) continue
    shell.push({ p, zone: zoneOf(p), n: rand(), fold: foldAt(p) })
  }
  for (let i = 0; i < 1700; i++) {
    const p = cerebellumPoint(randDir())
    if (p[1] > -0.25 && p[2] > -0.6) continue
    shell.push({ p, zone: 'cerebellum', n: rand(), fold: 0.5 + 0.5 * Math.sin(p[1] * 70 + p[2] * 10) })
  }
  // Ствол мозга
  for (let i = 0; i < 520; i++) {
    const t = rand()
    const a = rand() * Math.PI * 2
    const rad = 0.12 - 0.04 * t
    shell.push({ p: [Math.cos(a) * rad, -0.32 - t * 0.62, -0.28 - t * 0.12 + Math.sin(a) * rad * 0.8], zone: 'stem', n: rand(), fold: 0.6 })
  }

  // Нейроны — под корой, по зонам
  const neurons: Neuron[] = []
  const count: Record<ZoneKey, number> = { frontal: 0, parietal: 0, temporal: 0, occipital: 0, cerebellum: 0 }
  const minD = 0.075
  for (let i = 0; i < 60000 && neurons.length < 386; i++) {
    const cb = rand() < 0.16
    const depth = 0.8 + rand() * 0.14
    const p = cb ? cerebellumPoint(randDir(), 0.55 + rand() * 0.35) : cortexPoint(randDir(), depth)
    if (!cb && p[1] < -0.3 && p[2] < -0.45) continue
    const zone: ZoneKey = cb ? 'cerebellum' : zoneOf(p)
    if (count[zone] >= CAP[zone]) continue
    if (neurons.some((q) => Math.hypot(q.p[0] - p[0], q.p[1] - p[1], q.p[2] - p[2]) < minD)) continue
    count[zone]++
    neurons.push({ p, zone, rank: 0, phase: rand() * Math.PI * 2 })
  }
  const byZone = { frontal: [], parietal: [], temporal: [], occipital: [], cerebellum: [] } as Record<ZoneKey, number[]>
  neurons.forEach((n, i) => byZone[n.zone].push(i))
  for (const z of ZONES) {
    const c = CORE[z]
    const dist = (i: number) => {
      const [x, y, zz] = neurons[i].p
      return Math.hypot(Math.abs(x) - c[0], y - c[1], zz - c[2])
    }
    byZone[z].sort((a, b) => dist(a) - dist(b))
    byZone[z].forEach((idx, r) => { neurons[idx].rank = r })
  }

  // Связи: 3 ближайших соседа (в т.ч. через границы зон)
  const seen = new Set<string>()
  const edges: [number, number][] = []
  neurons.forEach((a, i) => {
    neurons
      .map((b, j) => ({ j, d: Math.hypot(a.p[0] - b.p[0], a.p[1] - b.p[1], a.p[2] - b.p[2]) }))
      .filter((o) => o.j !== i && o.d < 0.26)
      .sort((x, y) => x.d - y.d)
      .slice(0, 3)
      .forEach(({ j }) => {
        const key = i < j ? `${i}-${j}` : `${j}-${i}`
        if (!seen.has(key)) { seen.add(key); edges.push([i, j]) }
      })
  })

  cached = { shell, neurons, byZone, edges }
  return cached
}

// Сколько нейронов зоны горит при данном опыте (как в 2D-версии).
export function litFor(zone: ZoneKey, xp: number, m: Model) {
  const cap = m.byZone[zone].length
  if (xp <= 0) return 0
  return Math.max(1, cap * (1 - Math.exp(-xp / 700)))
}
