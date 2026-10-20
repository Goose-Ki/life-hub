import { useEffect, useRef, useState } from 'react'
import { api, ProductivityDay } from '../api'
import { addDays, formatDate, formatMinutes, today } from '../utils'
import { Card, ErrorNote, Tabs, useAction, useLoad } from './ui'

// Порядок серий снизу вверх; цвет закреплён за серией, а не за позицией.
const SERIES = [
  { key: 'study', label: 'Учёба', className: 'viz-study' },
  { key: 'tasks', label: 'Задачи', className: 'viz-tasks' },
  { key: 'workout', label: 'Тренировка', className: 'viz-workout' },
] as const

const GOALS = [30, 60, 90, 120, 180, 240, 300, 360]

// refreshKey меняется, когда на главной меняются задачи/учёба/тренировки — график перезапрашивается.
export function ProductivityCard({ refreshKey = '' }: { refreshKey?: string }) {
  const [range, setRange] = useState<'7' | '14' | '30'>('14')
  const [showTable, setShowTable] = useState(false)
  const to = today()
  const from = addDays(to, -(Number(range) - 1))
  const data = useLoad(() => api.productivity(from, to), [from, to, refreshKey])
  const { run, error } = useAction()

  const days = data.data?.days ?? []
  const goal = data.data?.study_goal_min ?? 120
  const todayDay = days.find((d) => d.date === to)
  const past = days.filter((d) => d.date <= to)
  const avg = past.length ? Math.round(past.reduce((s, d) => s + d.score, 0) / past.length) : 0
  const best = past.reduce<ProductivityDay | null>((b, d) => (!b || d.score > b.score ? d : b), null)

  const setGoal = (m: number) => run(() => api.settings.put({ study_goal_min: m })).then((ok) => ok && data.reload())

  return (
    <Card className="span-2" title="Продуктивность" action={
      <Tabs value={range} onChange={setRange} items={[['7', '7 дней'], ['14', '14 дней'], ['30', '30 дней']]} />
    }>
      <div className="prod-summary">
        <div className="stat"><span className="stat-value">{todayDay?.score ?? 0}</span><span className="stat-label">сегодня</span></div>
        <div className="stat"><span className="stat-value">{avg}</span><span className="stat-label">в среднем за {range} дн.</span></div>
        <div className="stat">
          <span className="stat-value">{best && best.score > 0 ? best.score : '—'}</span>
          <span className="stat-label">{best && best.score > 0 ? `лучший день · ${formatDate(best.date, { day: 'numeric', month: 'short' })}` : 'лучший день'}</span>
        </div>
      </div>

      <div className="legend-row" aria-hidden="true">
        {SERIES.map((s) => (
          <span key={s.key} className="legend-item"><span className={`swatch ${s.className}`} />{s.label}</span>
        ))}
      </div>

      {data.data && <ProductivityChart days={days} goal={goal} />}
      <ErrorNote error={data.error ?? error} />

      <div className="prod-footer">
        <label className="inline-label">Цель учёбы на день
          <select value={goal} onChange={(e) => setGoal(Number(e.target.value))}>
            {[...new Set([...GOALS, goal])].sort((a, b) => a - b).map((m) => <option key={m} value={m}>{formatMinutes(m)}</option>)}
          </select>
        </label>
        <span className="muted small">Балл 0–100: задачи до 40, учёба до 40, тренировка 20. Дни без задач не штрафуются.</span>
        <button className="btn ghost small" onClick={() => setShowTable(!showTable)}>{showTable ? 'Скрыть таблицу' : 'Таблица'}</button>
      </div>

      {showTable && (
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>День</th><th>Балл</th><th>Задачи</th><th>Учёба</th><th>Тренировка</th></tr></thead>
            <tbody>
              {[...days].reverse().map((d) => (
                <tr key={d.date}>
                  <td>{formatDate(d.date, { day: 'numeric', month: 'short', weekday: 'short' })}</td>
                  <td><strong>{d.score}</strong></td>
                  <td>{d.tasks_planned ? `${d.tasks_done} из ${d.tasks_planned}` : '—'}</td>
                  <td>{d.study_minutes ? formatMinutes(d.study_minutes) : '—'}</td>
                  <td>{d.workouts ? 'да' : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}

function ProductivityChart({ days, goal }: { days: ProductivityDay[]; goal: number }) {
  const [hover, setHover] = useState<number | null>(null)
  // Рисуем в реальных пикселях контейнера, чтобы подписи не мельчили на телефоне.
  const ref = useRef<HTMLElement>(null)
  const [W, setW] = useState(720)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e.contentRect.width))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const H = W < 500 ? 190 : 220
  const pad = { top: 12, right: 28, bottom: 28, left: 32 }
  const iw = W - pad.left - pad.right
  const ih = H - pad.top - pad.bottom
  const y = (v: number) => pad.top + ih - (v / 100) * ih
  const slot = iw / Math.max(1, days.length)
  const barW = Math.max(6, Math.min(30, slot * 0.62))
  const maxLabels = Math.max(2, Math.floor(iw / 46))
  const labelEvery = Math.ceil(days.length / maxLabels)
  const lastIdx = days.length - 1
  const t = today()
  const GAP = 2

  // Прямоугольник с закруглённым верхом (4px) — только для верхнего сегмента столбика.
  const topRounded = (x: number, top: number, w: number, bottom: number) => {
    const r = Math.min(4, w / 2, bottom - top)
    return `M${x},${bottom} V${top + r} Q${x},${top} ${x + r},${top} H${x + w - r} Q${x + w},${top} ${x + w},${top + r} V${bottom} Z`
  }

  const hd = hover !== null ? days[hover] : null

  return (
    <figure className="chart prod-chart" ref={ref}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label="Балл продуктивности по дням" onMouseLeave={() => setHover(null)}>
        {[0, 25, 50, 75, 100].map((v) => (
          <g key={v}>
            <line x1={pad.left} x2={W - pad.right} y1={y(v)} y2={y(v)} className="grid" />
            <text x={pad.left - 8} y={y(v)} className="axis" textAnchor="end" dominantBaseline="middle">{v}</text>
          </g>
        ))}
        {days.map((d, i) => {
          const cx = pad.left + slot * i + slot / 2
          const x = cx - barW / 2
          const segs = SERIES.map((s) => ({ ...s, value: d.parts[s.key] })).filter((s) => s.value > 0)
          let acc = 0
          const isToday = d.date === t
          const isFuture = d.date > t
          return (
            <g key={d.date} onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} tabIndex={0}
              className={hover !== null && hover !== i ? 'dim' : ''}
              aria-label={`${formatDate(d.date)}: ${d.score} баллов`}>
              <rect x={pad.left + slot * i} y={pad.top} width={slot} height={ih} fill="transparent" />
              {segs.map((s, si) => {
                const bottom = y(acc) - (si > 0 ? GAP : 0)
                acc += s.value
                const top = y(acc)
                if (bottom - top < 0.5) return null
                const last = si === segs.length - 1
                return last
                  ? <path key={s.key} d={topRounded(x, top, barW, bottom)} className={`seg ${s.className}`} />
                  : <rect key={s.key} x={x} y={top} width={barW} height={bottom - top} className={`seg ${s.className}`} />
              })}
              {d.score === 0 && !isFuture && <rect x={x} y={y(0) - 2} width={barW} height={2} rx={1} className="zero-mark" />}
              {(isToday || (i % labelEvery === 0 && lastIdx - i >= labelEvery)) && (
                <text x={cx} y={H - 8} className={`axis ${isToday ? 'axis-today' : ''}`} textAnchor="middle">
                  {isToday ? (W < 500 ? 'сег.' : 'сегодня') : days.length <= 7
                    ? formatDate(d.date, { weekday: 'short' })
                    : formatDate(d.date, { day: 'numeric', month: 'numeric' })}
                </text>
              )}
            </g>
          )
        })}
        <line x1={pad.left} x2={W - pad.right} y1={y(0)} y2={y(0)} className="baseline" />
      </svg>
      {hd && hover !== null && (
        <div className="tooltip prod-tooltip" style={{
          left: `${Math.min(86, Math.max(14, ((pad.left + slot * hover + slot / 2) / W) * 100))}%`,
          top: `${(y(Math.max(hd.score, 0)) / H) * 100}%`,
        }}>
          <div className="tooltip-label">{formatDate(hd.date, { day: 'numeric', month: 'long', weekday: 'short' })}</div>
          <div className="tooltip-value">{hd.score} из 100</div>
          <div className="tooltip-rows">
            <div><span className="swatch viz-study" />Учёба: {formatMinutes(hd.study_minutes)} (цель {formatMinutes(goal)})</div>
            <div><span className="swatch viz-tasks" />Задачи: {hd.tasks_planned ? `${hd.tasks_done} из ${hd.tasks_planned}` : 'не было'}</div>
            <div><span className="swatch viz-workout" />Тренировка: {hd.workouts ? 'да' : 'нет'}</div>
          </div>
        </div>
      )}
    </figure>
  )
}
