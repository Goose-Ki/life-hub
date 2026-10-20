import { ComponentProps, lazy, Suspense, useCallback, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, Brain, ZoneKey } from '../../api'
import { formatDate } from '../../utils'
import { useAuth } from '../auth'
import { Card, Empty, ErrorNote, useLoad } from '../ui'
import { BrainCanvas, ZoneMeta, ZoneXP } from './BrainCanvas'
import { ZONE_COLORS } from './geometry'

// 3D-версия грузится отдельным чанком (three.js), без WebGL — 2D-холст.
const Brain3D = lazy(() => import('../brain3d/Brain3D'))

function hasWebGL() {
  try {
    const c = document.createElement('canvas')
    return !!(c.getContext('webgl2') || c.getContext('webgl'))
  } catch {
    return false
  }
}

function BrainScene(props: ComponentProps<typeof BrainCanvas>) {
  const [gl] = useState(hasWebGL)
  if (!gl) return <BrainCanvas {...props} />
  return (
    <Suspense fallback={<div className={`brain3d-loading ${props.compact ? 'compact' : ''}`}><span /></div>}>
      <Brain3D {...props} />
    </Suspense>
  )
}

// Ключ — свой у каждого пользователя (на одном устройстве могут входить разные люди).
const storageKey = (uid: number) => `lifehub.brain.seen.${uid}`

interface Seen { zones: ZoneXP; total: number; level: number }

function readSeen(uid: number): Seen | null {
  try {
    const raw = localStorage.getItem(storageKey(uid))
    return raw ? (JSON.parse(raw) as Seen) : null
  } catch {
    return null
  }
}

function zoneXP(b: Brain): ZoneXP {
  return Object.fromEntries(b.zones.map((z) => [z.key, z.xp])) as ZoneXP
}

// Что пользователь видел в прошлый раз: от этого состояния анимируется рост.
// seen — снимок на момент открытия (для «+XP» и «новый уровень»), from — откуда анимировать сейчас.
function useBrainProgress() {
  const { user } = useAuth()
  const uid = user.id
  const [seen] = useState(() => readSeen(uid))
  const [from, setFrom] = useState<ZoneXP | undefined>(() => seen?.zones)
  const markSeen = useCallback((b: Brain) => {
    const snap: Seen = { zones: zoneXP(b), total: b.total_xp, level: b.level }
    setFrom(snap.zones)
    try {
      localStorage.setItem(storageKey(uid), JSON.stringify(snap))
    } catch { /* приватный режим — просто не запоминаем */ }
  }, [uid])
  return { seen, from, markSeen }
}

function zoneMeta(b: Brain) {
  return Object.fromEntries(b.zones.map((z) => [z.key, { name: z.name, desc: z.desc, level: z.level, xp: z.xp }])) as Record<ZoneKey, ZoneMeta>
}

function LevelBadge({ b, size = 'big' }: { b: Brain; size?: 'big' | 'small' }) {
  const pct = ((b.total_xp - b.level_from) / Math.max(1, b.level_to - b.level_from)) * 100
  return (
    <div className={`level-badge ${size}`}>
      <div className="level-ring" style={{ ['--p' as string]: `${pct}%` }}>
        <span className="level-num">{b.level}</span>
        <span className="level-cap">ур.</span>
      </div>
      <div className="level-info">
        <div className="level-title">{b.title}</div>
        <div className="xp-bar"><div style={{ width: `${pct}%` }} /></div>
        <div className="xp-text">{b.total_xp - b.level_from} / {b.level_to - b.level_from} XP до {b.level + 1} уровня</div>
      </div>
    </div>
  )
}

// ---------- Карточка на главной ----------

export function BrainCard({ refreshKey = '' }: { refreshKey?: string }) {
  const data = useLoad(() => api.brain(), [refreshKey])
  const { seen, from, markSeen } = useBrainProgress()
  const b = data.data
  return (
    <Card className="brain-card" title="Мозг" action={<Link className="link small" to="/brain">Открыть →</Link>}>
      <ErrorNote error={data.error} />
      {b && (
        <>
          <BrainScene compact xp={zoneXP(b)} fromXp={from} achievements={b.achievements}
            zoneMeta={zoneMeta(b)} celebrate={!!seen && b.level > seen.level} onGrown={() => markSeen(b)} />
          <LevelBadge b={b} size="small" />
        </>
      )}
    </Card>
  )
}

// ---------- Страница «Мозг» ----------

export default function BrainPage() {
  const data = useLoad(() => api.brain(), [])
  const { seen, from, markSeen } = useBrainProgress()
  const [hl, setHl] = useState<ZoneKey | null>(null)
  const [canvasHover, setCanvasHover] = useState<ZoneKey | null>(null)
  const b = data.data
  const gained = b && seen ? b.total_xp - seen.total : 0
  const levelUp = b && seen && b.level > seen.level

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Мозг</h1>
          <div className="muted">Учёба, навыки, книги, задачи и тренировки зажигают нейроны в своих зонах</div>
        </div>
      </header>
      <ErrorNote error={data.error} />

      {b && (
        <section className="brain-hero">
          <div className="brain-stage">
            {/* Без нового опыта — каждый раз красивое «включение» с нуля; иначе рост от прошлого визита */}
            <BrainScene xp={zoneXP(b)} fromXp={from === seen?.zones && gained <= 0 ? undefined : from} achievements={b.achievements}
              zoneMeta={zoneMeta(b)} highlight={hl} celebrate={!!levelUp} onHoverZone={setCanvasHover} onGrown={() => markSeen(b)} />
            {levelUp && <div className="levelup-banner">Новый уровень · {b.level}</div>}
          </div>
          <aside className="brain-side">
            <LevelBadge b={b} />
            {gained > 0 && <div className="xp-gain">+{gained} XP с прошлого визита</div>}
            <div className="brain-stats">
              <div><strong>{Math.round(b.stats.study_minutes / 60)}</strong><span>ч учёбы</span></div>
              <div><strong>{b.stats.skills}</strong><span>навыков</span></div>
              <div><strong>{b.stats.books_done}</strong><span>книг прочитано</span></div>
              <div><strong>{b.stats.pages_read}</strong><span>страниц</span></div>
              <div><strong>{b.stats.tasks_done}</strong><span>задач сделано</span></div>
              <div><strong>{b.stats.workouts}</strong><span>тренировок</span></div>
            </div>
            <div className="brain-legend">
              <span><i className="lg-node" /> навык</span>
              <span><i className="lg-book" /> книга</span>
              <span className="muted">наведи на мозг, чтобы узнать подробности</span>
            </div>
          </aside>
        </section>
      )}

      {b && (
        <div className="brain-cols">
          <Card title="Зоны мозга">
            <ul className="zone-list">
              {b.zones.map((z) => {
                const pct = ((z.xp - z.level_from) / Math.max(1, z.level_to - z.level_from)) * 100
                return (
                  <li key={z.key} className={canvasHover === z.key || hl === z.key ? 'active' : ''}
                    style={{ ['--zc' as string]: ZONE_COLORS[z.key] }}
                    onMouseEnter={() => setHl(z.key)} onMouseLeave={() => setHl(null)}>
                    <div className="zone-head">
                      <span className="zone-dot" />
                      <div className="zone-name">
                        <strong>{z.name}</strong>
                        <span className="muted small">{z.desc}</span>
                      </div>
                      <span className="zone-level">ур. {z.level}</span>
                    </div>
                    <div className="zone-bar"><div style={{ width: `${pct}%` }} /></div>
                    <div className="muted small zone-src">
                      {z.xp} XP{z.sources.length ? ' · ' + z.sources.map((s) => `${s.label.toLowerCase()} ${s.xp}`).join(', ') : ' · пока пусто'}
                    </div>
                  </li>
                )
              })}
            </ul>
          </Card>

          <div className="brain-col">
            <Card title="Достижения">
              {b.achievements.length === 0 && (
                <Empty>Отметь тему как «Готово» или дочитай книгу — здесь появятся навыки и книги, а в мозге загорятся ядра.</Empty>
              )}
              <ul className="ach-list">
                {b.achievements.slice(0, 12).map((a, i) => (
                  <li key={i} style={{ ['--zc' as string]: ZONE_COLORS[a.zone] }}>
                    <span className={`ach-icon ${a.kind}`} />
                    <div className="ach-main">
                      <div className="ach-title">{a.title}</div>
                      <div className="muted small">
                        {a.kind === 'book' ? 'Книга' : 'Навык'} · {b.zones.find((z) => z.key === a.zone)?.name} · {formatDate(a.date, { day: 'numeric', month: 'short' })}
                      </div>
                    </div>
                    <span className="ach-xp">+{a.xp}</span>
                  </li>
                ))}
              </ul>
            </Card>

            <Card title="Как растёт мозг">
              <ul className="rules">
                <li><span>1 минута учёбы</span><b>1 XP</b></li>
                <li><span>Тема «Готово» — новый навык</span><b>150 XP</b></li>
                <li><span>Прочитанная книга</span><b>100 + стр./2</b></li>
                <li><span>Книга в процессе</span><b>стр./2</b></li>
                <li><span>Выполненная задача</span><b>10 XP</b></li>
                <li><span>Тренировка</span><b>30 + мин/2</b></li>
              </ul>
              <p className="muted small">
                Опыт идёт в зону области знаний темы или книги: логика — теменная доля, языки и гуманитарное — височная,
                творчество — затылочная, саморазвитие и задачи — лобная, тренировки — мозжечок.
                Области задаются в «Учёба → План» и «Учёба → Книги».
              </p>
            </Card>
          </div>
        </div>
      )}
    </div>
  )
}
