import { useState } from 'react'
import { DayMinutes } from '../api'
import { formatDate, formatMinutes } from '../utils'

// Столбчатая диаграмма минут учёбы по дням: одна серия, ось Y в часах, подсказка при наведении.
export function StudyChart({ data }: { data: DayMinutes[] }) {
  const [hover, setHover] = useState<number | null>(null)
  const W = 640, H = 220
  const pad = { top: 16, right: 8, bottom: 28, left: 36 }
  const iw = W - pad.left - pad.right
  const ih = H - pad.top - pad.bottom

  const maxMin = Math.max(60, ...data.map((d) => d.minutes))
  const stepH = maxMin <= 180 ? 1 : maxMin <= 480 ? 2 : 4
  const topH = Math.ceil(maxMin / 60 / stepH) * stepH
  const y = (m: number) => pad.top + ih - (m / (topH * 60)) * ih
  const ticks = Array.from({ length: topH / stepH + 1 }, (_, i) => i * stepH)

  const slot = iw / Math.max(1, data.length)
  const barW = Math.max(3, Math.min(28, slot - 2))
  const labelEvery = Math.ceil(data.length / 10)
  const total = data.reduce((s, d) => s + d.minutes, 0)

  const barPath = (x: number, top: number, w: number, bottom: number) => {
    const r = Math.min(4, w / 2, bottom - top)
    return `M${x},${bottom} V${top + r} Q${x},${top} ${x + r},${top} H${x + w - r} Q${x + w},${top} ${x + w},${top + r} V${bottom} Z`
  }

  return (
    <figure className="chart" aria-label={`Время учёбы: всего ${formatMinutes(total)}`}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.left} x2={W - pad.right} y1={y(t * 60)} y2={y(t * 60)} className="grid" />
            <text x={pad.left - 8} y={y(t * 60)} className="axis" textAnchor="end" dominantBaseline="middle">{t}ч</text>
          </g>
        ))}
        {data.map((d, i) => {
          const cx = pad.left + slot * i + slot / 2
          const bottom = y(0)
          return (
            <g key={d.date} onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} tabIndex={0}>
              <rect x={cx - slot / 2} y={pad.top} width={slot} height={ih} fill="transparent" />
              {d.minutes > 0 && (
                <path d={barPath(cx - barW / 2, y(d.minutes), barW, bottom)}
                  className={`bar ${hover === i ? 'bar-hover' : ''}`} />
              )}
              {i % labelEvery === 0 && (
                <text x={cx} y={H - 8} className="axis" textAnchor="middle">
                  {formatDate(d.date, { day: 'numeric', month: 'numeric' })}
                </text>
              )}
            </g>
          )
        })}
        <line x1={pad.left} x2={W - pad.right} y1={y(0)} y2={y(0)} className="baseline" />
      </svg>
      {hover !== null && data[hover] && (
        <div className="tooltip" style={{ left: `${((pad.left + slot * hover + slot / 2) / W) * 100}%` }}>
          <div className="tooltip-label">{formatDate(data[hover].date, { day: 'numeric', month: 'long', weekday: 'short' })}</div>
          <div className="tooltip-value">{data[hover].minutes ? formatMinutes(data[hover].minutes) : 'без учёбы'}</div>
        </div>
      )}
    </figure>
  )
}
