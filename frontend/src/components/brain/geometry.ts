// Геометрия «мозга»: силуэт (вид сбоку, лоб слева), зоны, нейроны и связи.
// Всё считается один раз в координатах 600×440 и масштабируется при отрисовке.
import { ZoneKey } from '../../api'

export const VIEW_W = 600
export const VIEW_H = 440

export const CEREBRUM = `M 110 292
  C 58 272, 38 200, 68 140
  C 94 80, 170 40, 262 38
  C 352 32, 452 56, 512 112
  C 562 158, 572 228, 532 272
  C 512 294, 482 302, 456 300
  C 420 322, 380 337, 330 342
  C 260 350, 190 342, 150 320
  C 126 307, 116 300, 110 292 Z`

export const CEREBELLUM = `M 438 304
  C 470 290, 532 286, 548 318
  C 562 348, 522 376, 480 374
  C 444 372, 418 348, 423 323
  C 426 311, 431 306, 438 304 Z`

export const STEM = `M 392 330 C 398 362, 400 394, 398 432 L 432 432 C 428 398, 428 366, 436 336 Z`

// Декоративные борозды (извилины) — рисуются тонкими линиями внутри силуэта.
export const SULCI = [
  'M 92 180 C 120 170, 140 190, 165 175 S 205 160, 215 185',
  'M 85 230 C 115 222, 135 240, 170 228 S 210 215, 225 235',
  'M 120 110 C 145 125, 170 105, 195 120 S 230 110, 250 125',
  'M 175 70 C 190 95, 215 80, 230 98',
  'M 330 60 C 345 85, 370 70, 390 92 S 420 85, 440 105',
  'M 320 120 C 345 135, 370 118, 395 138 S 430 130, 445 150',
  'M 300 175 C 330 190, 355 170, 385 190 S 420 185, 440 200',
  'M 470 110 C 485 130, 500 120, 520 140',
  'M 470 175 C 490 190, 510 178, 540 200',
  'M 465 240 C 485 255, 505 245, 530 258',
  'M 170 300 C 200 290, 230 310, 265 298 S 320 290, 350 305',
  'M 200 325 C 235 318, 270 332, 310 322',
  'M 432 320 C 460 312, 500 316, 540 330',
  'M 436 340 C 465 334, 505 338, 545 348',
  'M 450 358 C 475 354, 505 358, 530 364',
]

// Границы долей (центральная, сильвиева, теменно-затылочная борозды).
export const sylvianY = (x: number) => 294 - (x - 130) * 0.22
export const centralX = (y: number) => 300 - (y - 38) * 0.3
export const parietoOccipitalX = (y: number) => 446 + (y - 60) * 0.05

export const BOUNDARIES = [
  `M 300 38 L ${centralX(250).toFixed(1)} 250`,
  `M 128 ${sylvianY(128).toFixed(1)} L 456 ${sylvianY(456).toFixed(1)}`,
  `M 446 60 L ${parietoOccipitalX(296).toFixed(1)} 296`,
]

export const ZONE_ORDER: ZoneKey[] = ['frontal', 'parietal', 'temporal', 'occipital', 'cerebellum']

export const ZONE_COLORS: Record<ZoneKey, string> = {
  frontal: '#f5a524',
  parietal: '#22d3ee',
  temporal: '#a78bfa',
  occipital: '#f472b6',
  cerebellum: '#34d399',
}

const ZONE_CAP: Record<ZoneKey, number> = { frontal: 48, parietal: 54, temporal: 40, occipital: 34, cerebellum: 30 }
// «Ядро» зоны — отсюда начинают загораться нейроны.
const ZONE_CORE: Record<ZoneKey, [number, number]> = {
  frontal: [150, 160], parietal: [355, 115], temporal: [270, 295], occipital: [500, 195], cerebellum: [488, 332],
}
export const ZONE_LABEL_POS: Record<ZoneKey, [number, number]> = {
  frontal: [150, 150], parietal: [360, 110], temporal: [275, 300], occipital: [505, 190], cerebellum: [486, 334],
}

export interface Neuron { x: number; y: number; zone: ZoneKey; rank: number; phase: number }
export interface Edge { a: number; b: number; len: number }
export interface Network {
  neurons: Neuron[]
  edges: Edge[]
  byZone: Record<ZoneKey, number[]> // индексы нейронов зоны в порядке загорания
  cerebrum: Path2D
  cerebellum: Path2D
  stem: Path2D
}

// Детерминированный генератор — сеть всегда одинаковая.
function mulberry32(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function zoneOf(x: number, y: number, inCerebellum: boolean): ZoneKey {
  if (inCerebellum) return 'cerebellum'
  if (x > 100 && x < 456 && y > sylvianY(x)) return 'temporal'
  if (x < centralX(y)) return 'frontal'
  if (x > parietoOccipitalX(y)) return 'occipital'
  return 'parietal'
}

let cached: Network | null = null

export function buildNetwork(): Network {
  if (cached) return cached
  const cerebrum = new Path2D(CEREBRUM)
  const cerebellum = new Path2D(CEREBELLUM)
  const stem = new Path2D(STEM)
  const ctx = document.createElement('canvas').getContext('2d')!
  const inside = (p: Path2D, x: number, y: number, m: number) =>
    ctx.isPointInPath(p, x, y) && ctx.isPointInPath(p, x + m, y) && ctx.isPointInPath(p, x - m, y) &&
    ctx.isPointInPath(p, x, y + m) && ctx.isPointInPath(p, x, y - m)

  const rand = mulberry32(20061210)
  const pts: Neuron[] = []
  const count: Record<ZoneKey, number> = { frontal: 0, parietal: 0, temporal: 0, occipital: 0, cerebellum: 0 }
  const minD2 = 13 * 13
  for (let i = 0; i < 20000 && pts.length < 206; i++) {
    const x = 50 + rand() * 510
    const y = 34 + rand() * 345
    const inCb = inside(cerebellum, x, y, 7)
    if (!inCb && !inside(cerebrum, x, y, 9)) continue
    const zone = zoneOf(x, y, inCb)
    if (count[zone] >= ZONE_CAP[zone]) continue
    if (pts.some((p) => (p.x - x) ** 2 + (p.y - y) ** 2 < minD2)) continue
    count[zone]++
    pts.push({ x, y, zone, rank: 0, phase: rand() * Math.PI * 2 })
  }

  const byZone = { frontal: [], parietal: [], temporal: [], occipital: [], cerebellum: [] } as Record<ZoneKey, number[]>
  pts.forEach((p, i) => byZone[p.zone].push(i))
  for (const z of ZONE_ORDER) {
    const [cx, cy] = ZONE_CORE[z]
    byZone[z].sort((a, b) => Math.hypot(pts[a].x - cx, pts[a].y - cy) - Math.hypot(pts[b].x - cx, pts[b].y - cy))
    byZone[z].forEach((idx, r) => { pts[idx].rank = r })
  }

  // Связи: каждый нейрон — с 3 ближайшими соседями (в т.ч. из соседних зон).
  const seen = new Set<string>()
  const edges: Edge[] = []
  pts.forEach((p, i) => {
    const near = pts
      .map((q, j) => ({ j, d: Math.hypot(p.x - q.x, p.y - q.y) }))
      .filter((o) => o.j !== i && o.d < 46)
      .sort((a, b) => a.d - b.d)
      .slice(0, 3)
    for (const { j, d } of near) {
      const key = i < j ? `${i}-${j}` : `${j}-${i}`
      if (seen.has(key)) continue
      seen.add(key)
      edges.push({ a: i, b: j, len: d })
    }
  })

  cached = { neurons: pts, edges, byZone, cerebrum, cerebellum, stem }
  return cached
}

// Сколько нейронов зоны горит при данном опыте: быстро в начале, дальше всё медленнее.
export function litFor(zone: ZoneKey, xp: number, net: Network) {
  const cap = net.byZone[zone].length
  if (xp <= 0) return 0
  return Math.max(1, cap * (1 - Math.exp(-xp / 700)))
}
