import { FormEvent, useState } from 'react'
import { api, Workout } from '../api'
import { Card, ConfirmDelete, Empty, ErrorNote, Icon, Modal, useAction, useLoad } from '../components/ui'
import { addDays, formatMinutes, groupBy, relativeDay, today } from '../utils'

const DEFAULT_KINDS = ['Зал', 'Бег', 'Велосипед', 'Плавание', 'Растяжка', 'Футбол', 'Турники', 'Ходьба']

export function WorkoutForm({ workout, defaultDate, onSaved, onCancel }: {
  workout?: Workout; defaultDate?: string; onSaved: () => void; onCancel?: () => void
}) {
  const [date, setDate] = useState(workout?.date ?? defaultDate ?? today())
  const [kind, setKind] = useState(workout?.kind ?? '')
  const [duration, setDuration] = useState(workout?.duration_min?.toString() ?? '')
  const [note, setNote] = useState(workout?.note ?? '')
  const { data: usedKinds } = useLoad(() => api.workouts.kinds(), [])
  const { run, error, busy } = useAction()
  const kinds = [...new Set([...(usedKinds ?? []), ...DEFAULT_KINDS])]

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const body = { date, kind, note, duration_min: duration ? Number(duration) : null }
    const ok = await run(() => (workout ? api.workouts.update(workout.id, body) : api.workouts.create(body)))
    if (ok) {
      if (!workout) { setKind(''); setDuration(''); setNote('') }
      onSaved()
    }
  }

  return (
    <form className="form" onSubmit={submit}>
      <div className="row">
        <label>Дата<input type="date" required value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <label>Тип
          <input list="workout-kinds" required value={kind} onChange={(e) => setKind(e.target.value)} placeholder="Зал, бег…" />
          <datalist id="workout-kinds">{kinds.map((k) => <option key={k} value={k} />)}</datalist>
        </label>
        <label>Минут
          <input type="number" min={1} max={1440} value={duration} onChange={(e) => setDuration(e.target.value)} placeholder="60" />
        </label>
      </div>
      <label>Заметка
        <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Что делал, как самочувствие" />
      </label>
      <ErrorNote error={error} />
      <div className="form-actions">
        {onCancel && <button type="button" className="btn ghost" onClick={onCancel}>Отмена</button>}
        <button className="btn primary" disabled={busy}>{workout ? 'Сохранить' : 'Записать'}</button>
      </div>
    </form>
  )
}

export function WorkoutList({ items, onChange }: { items: Workout[]; onChange: () => void }) {
  const [editing, setEditing] = useState<Workout | null>(null)
  const { run, error } = useAction()
  return (
    <>
      <ul className="entry-list">
        {items.map((w) => (
          <li key={w.id} className="entry">
            <span className="tag workout">{w.kind}</span>
            <div className="entry-text">
              {w.duration_min && <strong>{formatMinutes(w.duration_min)}</strong>}
              {w.duration_min && w.note && ' · '}
              {w.note}
            </div>
            <div className="entry-actions">
              <button className="icon-btn" onClick={() => setEditing(w)} aria-label="Изменить"><Icon name="edit" size={16} /></button>
              <ConfirmDelete onConfirm={() => run(() => api.workouts.remove(w.id)).then((ok) => ok && onChange())} />
            </div>
          </li>
        ))}
      </ul>
      <ErrorNote error={error} />
      {editing && (
        <Modal title="Изменить тренировку" onClose={() => setEditing(null)}>
          <WorkoutForm workout={editing} onSaved={() => { setEditing(null); onChange() }} onCancel={() => setEditing(null)} />
        </Modal>
      )}
    </>
  )
}

export default function WorkoutsPage() {
  const to = today()
  const from = addDays(to, -89)
  const { data, error, reload } = useLoad(() => api.workouts.list(from, to), [from, to])
  const items = data ?? []

  const weekFrom = addDays(to, -6)
  const week = items.filter((w) => w.date >= weekFrom)
  const weekMinutes = week.reduce((s, w) => s + (w.duration_min ?? 0), 0)
  const monthCount = items.filter((w) => w.date >= addDays(to, -29)).length

  return (
    <div className="page">
      <header className="page-head"><h1>Дневник тренировок</h1></header>
      <div className="stats">
        <div className="stat"><span className="stat-value">{week.length}</span><span className="stat-label">за 7 дней</span></div>
        <div className="stat"><span className="stat-value">{formatMinutes(weekMinutes)}</span><span className="stat-label">время за 7 дней</span></div>
        <div className="stat"><span className="stat-value">{monthCount}</span><span className="stat-label">за 30 дней</span></div>
      </div>
      <Card title="Новая тренировка"><WorkoutForm onSaved={reload} /></Card>
      <ErrorNote error={error} />
      {data && items.length === 0 && <Empty>Тренировок за последние 90 дней нет.</Empty>}
      {groupBy(items, (w) => w.date).map(([date, list]) => (
        <Card key={date} title={relativeDay(date)}><WorkoutList items={list} onChange={reload} /></Card>
      ))}
    </div>
  )
}
