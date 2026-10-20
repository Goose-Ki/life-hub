import { FormEvent, useState } from 'react'
import { api, FoodEntry } from '../api'
import { Card, ConfirmDelete, Empty, ErrorNote, Icon, Modal, useAction, useLoad } from '../components/ui'
import { addDays, groupBy, relativeDay, today, toISO } from '../utils'

// Текущее время в формате ЧЧ:ММ.
export const nowTime = () => new Date().toTimeString().slice(0, 5)

export function FoodForm({ entry, defaultDate, onSaved, onCancel, compact = false }: {
  entry?: FoodEntry; defaultDate?: string; onSaved: () => void; onCancel?: () => void; compact?: boolean
}) {
  const [date, setDate] = useState(entry?.date ?? defaultDate ?? today())
  const [time, setTime] = useState(entry?.time ?? nowTime())
  const [content, setContent] = useState(entry?.content ?? '')
  const { run, error, busy } = useAction()

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const body = { date, time, content }
    const ok = await run(() => (entry ? api.food.update(entry.id, body) : api.food.create(body)))
    if (ok) {
      if (!entry) { setContent(''); setTime(nowTime()) }
      onSaved()
    }
  }

  return (
    <form className="form" onSubmit={submit}>
      <div className="row">
        {!compact && (
          <label>Дата<input type="date" required value={date} onChange={(e) => setDate(e.target.value)} /></label>
        )}
        <label>Время
          <div className="input-with-btn">
            <input type="time" required value={time} onChange={(e) => setTime(e.target.value)} />
            <button type="button" className="btn ghost small" onClick={() => setTime(nowTime())}>Сейчас</button>
          </div>
        </label>
      </div>
      <label>Что съел
        <textarea rows={compact ? 2 : 3} required value={content} onChange={(e) => setContent(e.target.value)}
          placeholder="Например: овсянка на молоке, банан, кофе с молоком"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) (e.currentTarget.form as HTMLFormElement).requestSubmit()
          }} />
      </label>
      <ErrorNote error={error} />
      <div className="form-actions">
        {onCancel && <button type="button" className="btn ghost" onClick={onCancel}>Отмена</button>}
        <button className="btn primary" disabled={busy}>{entry ? 'Сохранить' : 'Записать'}</button>
      </div>
    </form>
  )
}

export function FoodList({ entries, onChange }: { entries: FoodEntry[]; onChange: () => void }) {
  const [editing, setEditing] = useState<FoodEntry | null>(null)
  const { run, error } = useAction()
  return (
    <>
      <ul className="entry-list">
        {entries.map((e) => (
          <li key={e.id} className="entry">
            <span className="tag food-time">{e.time}</span>
            <p className="entry-text">{e.content}</p>
            <div className="entry-actions">
              <button className="icon-btn" onClick={() => setEditing(e)} aria-label="Изменить"><Icon name="edit" size={16} /></button>
              <ConfirmDelete onConfirm={() => run(() => api.food.remove(e.id)).then((ok) => ok && onChange())} />
            </div>
          </li>
        ))}
      </ul>
      <ErrorNote error={error} />
      {editing && (
        <Modal title="Изменить запись" onClose={() => setEditing(null)}>
          <FoodForm entry={editing} onSaved={() => { setEditing(null); onChange() }} onCancel={() => setEditing(null)} />
        </Modal>
      )}
    </>
  )
}

export default function FoodPage() {
  const [days, setDays] = useState(14)
  const [exporting, setExporting] = useState(false)
  const to = today()
  const { data, error, reload } = useLoad(() => api.food.list(addDays(to, -(days - 1)), to), [days, to])
  const groups = groupBy(data ?? [], (e) => e.date)

  return (
    <div className="page">
      <header className="page-head">
        <h1>Дневник питания</h1>
        <button className="btn ghost" onClick={() => setExporting(true)}><Icon name="download" size={16} /> Экспорт в Excel</button>
      </header>
      {exporting && <ExportDialog onClose={() => setExporting(false)} />}
      <Card title="Новая запись">
        <FoodForm onSaved={reload} />
      </Card>
      <ErrorNote error={error} />
      {data && groups.length === 0 && <Empty>За последние {days} дней записей нет.</Empty>}
      {groups.map(([date, entries]) => (
        <Card key={date} title={relativeDay(date)} action={<span className="muted small">{entries.length} зап.</span>}>
          <FoodList entries={entries} onChange={reload} />
        </Card>
      ))}
      {data && data.length > 0 && (
        <button className="btn ghost wide" onClick={() => setDays(days + 30)}>Показать ещё 30 дней</button>
      )}
    </div>
  )
}

type Preset = 'week' | 'month' | 'thisMonth' | 'prevMonth' | 'all' | 'custom'

function presetRange(p: Preset, custom: { from: string; to: string }): { from?: string; to?: string } {
  const t = today()
  const now = new Date()
  switch (p) {
    case 'week': return { from: addDays(t, -6), to: t }
    case 'month': return { from: addDays(t, -29), to: t }
    case 'thisMonth': return { from: toISO(new Date(now.getFullYear(), now.getMonth(), 1)), to: t }
    case 'prevMonth': return {
      from: toISO(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
      to: toISO(new Date(now.getFullYear(), now.getMonth(), 0)),
    }
    case 'all': return {}
    case 'custom': return custom
  }
}

// Выбор периода и скачивание .xlsx (файл отдаёт бэкенд).
function ExportDialog({ onClose }: { onClose: () => void }) {
  const [preset, setPreset] = useState<Preset>('month')
  const [custom, setCustom] = useState({ from: addDays(today(), -29), to: today() })
  const range = presetRange(preset, custom)
  const invalid = preset === 'custom' && (!custom.from || !custom.to || custom.from > custom.to)
  const options: [Preset, string][] = [
    ['week', 'Последние 7 дней'], ['month', 'Последние 30 дней'], ['thisMonth', 'Этот месяц'],
    ['prevMonth', 'Прошлый месяц'], ['all', 'Всё время'], ['custom', 'Свой период'],
  ]
  return (
    <Modal title="Экспорт в Excel" onClose={onClose}>
      <div className="form">
        <div className="chips">
          {options.map(([k, label]) => (
            <button type="button" key={k} className={`chip ${preset === k ? 'active' : ''}`} onClick={() => setPreset(k)}>{label}</button>
          ))}
        </div>
        {preset === 'custom' && (
          <div className="row">
            <label>С<input type="date" value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} /></label>
            <label>По<input type="date" value={custom.to} onChange={(e) => setCustom({ ...custom, to: e.target.value })} /></label>
          </div>
        )}
        <p className="muted small">
          В файле два листа: «Записи» — каждая запись отдельной строкой со временем, «По дням» — один день в строке: сколько раз ел, первый и последний приём и всё съеденное по времени.
        </p>
        {invalid && <div className="error-note">Дата начала должна быть не позже даты конца.</div>}
        <div className="form-actions">
          <button type="button" className="btn ghost" onClick={onClose}>Отмена</button>
          <a className={`btn primary ${invalid ? 'disabled' : ''}`} href={invalid ? undefined : api.food.exportUrl(range.from, range.to)}
            download onClick={() => !invalid && setTimeout(onClose, 300)}>
            <Icon name="download" size={16} /> Скачать .xlsx
          </a>
        </div>
      </div>
    </Modal>
  )
}
