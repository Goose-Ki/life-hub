import { useState } from 'react'
import { api } from '../api'
import { QuickTask, TaskForm, TaskRow } from '../components/Tasks'
import { Card, Empty, ErrorNote, Icon, useLoad } from '../components/ui'
import { formatDate, formatMinutes, fromISO, today, toISO, WEEKDAYS_SHORT } from '../utils'

const monthKey = (d: Date) => toISO(d).slice(0, 7)

export default function CalendarPage() {
  const [cursor, setCursor] = useState(() => { const d = new Date(); d.setDate(1); return d })
  const [selected, setSelected] = useState(today())
  const [creating, setCreating] = useState(false)
  const month = monthKey(cursor)

  const cal = useLoad(() => api.calendar(month), [month])
  const day = useLoad(() => api.day(selected), [selected])
  const inbox = useLoad(() => api.tasks.undated(), [])
  const overdue = useLoad(() => api.tasks.overdue(), [])

  const reloadAll = () => { cal.reload(); day.reload(); inbox.reload(); overdue.reload() }

  const shift = (n: number) => setCursor((c) => new Date(c.getFullYear(), c.getMonth() + n, 1))
  const lead = (cursor.getDay() + 6) % 7 // пустые клетки до 1-го числа
  const cells: (string | null)[] = [...Array(lead).fill(null), ...(cal.data ?? []).map((d) => d.date)]
  while (cells.length % 7) cells.push(null)
  const byDate = new Map((cal.data ?? []).map((d) => [d.date, d]))
  const t = today()

  return (
    <div className="page">
      <header className="page-head">
        <h1>Календарь</h1>
        <button className="btn primary" onClick={() => setCreating(true)}><Icon name="plus" size={16} /> Задача</button>
      </header>

      <div className="calendar-layout">
        <Card className="calendar-card">
          <div className="month-nav">
            <button className="icon-btn" onClick={() => shift(-1)} aria-label="Предыдущий месяц"><Icon name="left" /></button>
            <h2>{cursor.toLocaleDateString('ru-RU', { month: 'long' }).replace(/^./, (c) => c.toUpperCase())} {cursor.getFullYear()}</h2>
            <button className="icon-btn" onClick={() => shift(1)} aria-label="Следующий месяц"><Icon name="right" /></button>
            <button className="btn ghost small" onClick={() => { const d = new Date(); d.setDate(1); setCursor(d); setSelected(t) }}>Сегодня</button>
          </div>
          <div className="month-grid">
            {WEEKDAYS_SHORT.map((w) => <div key={w} className="dow">{w}</div>)}
            {cells.map((date, i) => {
              if (!date) return <div key={`e${i}`} className="day empty-day" />
              const d = byDate.get(date)!
              const cls = ['day', date === t && 'is-today', date === selected && 'is-selected',
                fromISO(date).getDay() % 6 === 0 && 'weekend'].filter(Boolean).join(' ')
              return (
                <button key={date} className={cls} onClick={() => setSelected(date)}
                  aria-label={formatDate(date)}>
                  <span className="day-num">{fromISO(date).getDate()}</span>
                  <span className="day-marks">
                    {d.tasks_open > 0 && <span className="mark task" title={`Задач: ${d.tasks_open}`}>{d.tasks_open}</span>}
                    {d.tasks_open === 0 && d.tasks_done > 0 && <span className="mark task-done" title="Все задачи выполнены"><Icon name="check" size={10} /></span>}
                    {d.workouts > 0 && <span className="dot workout" title="Тренировка" />}
                    {d.study_minutes > 0 && <span className="dot study" title={`Учёба: ${formatMinutes(d.study_minutes)}`} />}
                    {d.food_entries > 0 && <span className="dot food" title="Записи о питании" />}
                  </span>
                </button>
              )
            })}
          </div>
          <div className="legend muted small">
            <span><span className="mark task">2</span> задачи</span>
            <span><span className="dot workout" /> тренировка</span>
            <span><span className="dot study" /> учёба</span>
            <span><span className="dot food" /> питание</span>
          </div>
          <ErrorNote error={cal.error} />
        </Card>

        <div className="calendar-side">
          <Card title={formatDate(selected)} action={day.data?.week_number ? (
            <span className="pill">{day.data.week_number}-я неделя · {day.data.parity === 'odd' ? 'верхняя' : 'нижняя'}</span>
          ) : undefined}>
            <ErrorNote error={day.error} />
            {day.data && (
              <>
                <ul className="task-list">
                  {day.data.tasks.map((task) => <TaskRow key={task.id} task={task} onChange={reloadAll} />)}
                </ul>
                <QuickTask date={selected} onAdded={reloadAll} />
                {day.data.classes.length > 0 && (
                  <div className="sub-section">
                    <h3>Пары</h3>
                    <ul className="compact-list">
                      {day.data.classes.map((c) => (
                        <li key={c.id}><span className="time">{c.start_time}</span>{c.subject}{c.room && <span className="muted"> · {c.room}</span>}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {(day.data.workouts.length > 0 || day.data.study_minutes > 0 || day.data.food.length > 0) && (
                  <div className="sub-section">
                    <h3>Дневники</h3>
                    <ul className="compact-list">
                      {day.data.workouts.map((w) => (
                        <li key={`w${w.id}`}><span className="dot workout" /> {w.kind}{w.duration_min ? `, ${formatMinutes(w.duration_min)}` : ''}</li>
                      ))}
                      {day.data.study_minutes > 0 && <li><span className="dot study" /> Учёба: {formatMinutes(day.data.study_minutes)}</li>}
                      {day.data.food.map((f) => (
                        <li key={`f${f.id}`}><span className="dot food" /> <span className="time">{f.time}</span> {f.content}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}
          </Card>

          {overdue.data && overdue.data.length > 0 && (
            <Card title="Просрочено" className="card-warn">
              <ul className="task-list">
                {overdue.data.map((task) => <TaskRow key={task.id} task={task} onChange={reloadAll} showDate />)}
              </ul>
            </Card>
          )}

          <Card title="Без даты">
            {inbox.data && inbox.data.length === 0 && <Empty>Сюда попадают задачи без срока.</Empty>}
            <ul className="task-list">
              {inbox.data?.map((task) => <TaskRow key={task.id} task={task} onChange={reloadAll} />)}
            </ul>
            <QuickTask date={null} onAdded={reloadAll} />
          </Card>
        </div>
      </div>

      {creating && <TaskForm defaultDate={selected} onClose={() => setCreating(false)} onSaved={reloadAll} />}
    </div>
  )
}
