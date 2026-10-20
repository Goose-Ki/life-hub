import { FormEvent, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api, Area, ClassItem, Parity, Topic, TopicStatus } from '../api'
import { StudyChart } from '../components/BarChart'
import { AreaSelect } from '../components/AreaSelect'
import { BooksTab } from './Books'
import { Card, ConfirmDelete, Empty, ErrorNote, Icon, Modal, Tabs, useAction, useLoad } from '../components/ui'
import {
  addDays, AREAS, formatDate, formatMinutes, groupBy, PARITY, relativeDay, STATUS, today, weekInfo, WEEKDAYS,
} from '../utils'

type Tab = 'schedule' | 'plan' | 'time' | 'books'

export default function StudyPage() {
  const [params, setParams] = useSearchParams()
  const tab = (params.get('tab') as Tab) || 'schedule'
  return (
    <div className="page">
      <header className="page-head"><h1>Обучение</h1></header>
      <Tabs value={tab} onChange={(t) => setParams({ tab: t })}
        items={[['schedule', 'Расписание пар'], ['plan', 'План самообучения'], ['time', 'Время учёбы'], ['books', 'Книги']]} />
      {tab === 'schedule' && <Schedule />}
      {tab === 'plan' && <Plan />}
      {tab === 'time' && <TimeLog />}
      {tab === 'books' && <BooksTab />}
    </div>
  )
}

// ================= Расписание пар =================

function Schedule() {
  const classes = useLoad(() => api.classes.list(), [])
  const settings = useLoad(() => api.settings.get(), [])
  const current = weekInfo(today(), settings.data?.semester_start ?? null)
  const [view, setView] = useState<Parity | null>(null)
  const parity: Parity = view ?? current?.parity ?? 'all'
  const [editing, setEditing] = useState<ClassItem | 'new' | null>(null)

  const visible = (classes.data ?? []).filter((c) => parity === 'all' || c.parity === 'all' || c.parity === parity)
  // Пн–Пт всегда, выходные — только если на них есть пары.
  const days = [1, 2, 3, 4, 5, 6, 7].filter((wd) => wd <= 5 || (classes.data ?? []).some((c) => c.weekday === wd))

  return (
    <>
      <Card>
        <div className="toolbar">
          <SemesterStart value={settings.data?.semester_start ?? null} onSaved={settings.reload} />
          {current && (
            <span className="pill">Сейчас {current.number}-я неделя · {current.parity === 'odd' ? 'верхняя' : 'нижняя'}</span>
          )}
          <div className="spacer" />
          <Tabs value={parity} onChange={setView}
            items={[['all', 'Все'], ['odd', 'Верхняя'], ['even', 'Нижняя']]} />
          <button className="btn primary" onClick={() => setEditing('new')}><Icon name="plus" size={16} /> Пара</button>
        </div>
      </Card>
      <ErrorNote error={classes.error} />
      {classes.data && classes.data.length === 0 && (
        <Empty>Расписание пустое. Добавь пары — они появятся на главной и в календаре в нужные дни.</Empty>
      )}
      {classes.data && classes.data.length > 0 && (
        <div className="week-grid">
          {days.map((wd) => {
            const list = visible.filter((c) => c.weekday === wd)
            return (
              <section key={wd} className="week-col">
                <h3>{WEEKDAYS[wd - 1]}</h3>
                {list.length === 0 && <div className="muted small">Нет пар</div>}
                {list.map((c) => (
                  <button key={c.id} className="class-card" onClick={() => setEditing(c)}>
                    <div className="class-time">{c.start_time}–{c.end_time}</div>
                    <div className="class-subject">{c.subject}</div>
                    <div className="muted small">
                      {[c.kind, c.room, c.teacher].filter(Boolean).join(' · ')}
                    </div>
                    {c.parity !== 'all' && <span className={`tag parity-${c.parity}`}>{PARITY[c.parity]}</span>}
                  </button>
                ))}
              </section>
            )
          })}
        </div>
      )}
      {editing && (
        <ClassForm item={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)} onSaved={classes.reload} />
      )}
    </>
  )
}

function SemesterStart({ value, onSaved }: { value: string | null; onSaved: () => void }) {
  const { run, error } = useAction()
  return (
    <label className="inline-label">Начало семестра
      <input type="date" value={value ?? ''}
        onChange={(e) => run(() => api.settings.put({ semester_start: e.target.value || null })).then((ok) => ok && onSaved())} />
      <ErrorNote error={error} />
    </label>
  )
}

const PAIR_SLOTS = [
  ['09:00', '10:35'], ['10:50', '12:25'], ['12:40', '14:15'], ['14:30', '16:05'], ['16:20', '17:55'], ['18:00', '19:25'],
]

function ClassForm({ item, onClose, onSaved }: { item?: ClassItem; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    weekday: item?.weekday ?? 1, start_time: item?.start_time ?? '09:00', end_time: item?.end_time ?? '10:35',
    subject: item?.subject ?? '', kind: item?.kind ?? '', room: item?.room ?? '', teacher: item?.teacher ?? '',
    parity: item?.parity ?? ('all' as Parity),
  })
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }))
  const { run, error, busy } = useAction()

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const ok = await run(() => (item ? api.classes.update(item.id, f) : api.classes.create(f)))
    if (ok) { onSaved(); onClose() }
  }
  const remove = async () => {
    if (item && await run(() => api.classes.remove(item.id))) { onSaved(); onClose() }
  }

  return (
    <Modal title={item ? 'Пара' : 'Новая пара'} onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <label>Предмет<input autoFocus required value={f.subject} onChange={(e) => set('subject', e.target.value)} /></label>
        <div className="row">
          <label>День
            <select value={f.weekday} onChange={(e) => set('weekday', Number(e.target.value))}>
              {WEEKDAYS.map((w, i) => <option key={w} value={i + 1}>{w}</option>)}
            </select>
          </label>
          <label>Неделя
            <select value={f.parity} onChange={(e) => set('parity', e.target.value as Parity)}>
              {(['all', 'odd', 'even'] as Parity[]).map((p) => <option key={p} value={p}>{PARITY[p]}</option>)}
            </select>
          </label>
        </div>
        <div className="chips">
          {PAIR_SLOTS.map(([s, e], i) => (
            <button type="button" key={s} className={`chip ${f.start_time === s ? 'active' : ''}`}
              onClick={() => setF((p) => ({ ...p, start_time: s, end_time: e }))}>{i + 1} пара</button>
          ))}
        </div>
        <div className="row">
          <label>Начало<input type="time" required value={f.start_time} onChange={(e) => set('start_time', e.target.value)} /></label>
          <label>Конец<input type="time" required value={f.end_time} onChange={(e) => set('end_time', e.target.value)} /></label>
        </div>
        <div className="row">
          <label>Тип<input list="class-kinds" value={f.kind} onChange={(e) => set('kind', e.target.value)} placeholder="Лекция" />
            <datalist id="class-kinds"><option value="Лекция" /><option value="Практика" /><option value="Лабораторная" /><option value="Семинар" /></datalist>
          </label>
          <label>Аудитория<input value={f.room} onChange={(e) => set('room', e.target.value)} placeholder="Б-501" /></label>
        </div>
        <label>Преподаватель<input value={f.teacher} onChange={(e) => set('teacher', e.target.value)} /></label>
        <ErrorNote error={error} />
        <div className="form-actions">
          {item && <button type="button" className="btn danger" onClick={remove}>Удалить</button>}
          <div className="spacer" />
          <button type="button" className="btn ghost" onClick={onClose}>Отмена</button>
          <button className="btn primary" disabled={busy}>Сохранить</button>
        </div>
      </form>
    </Modal>
  )
}

// ================= План самообучения =================

function Plan() {
  const topics = useLoad(() => api.study.topics(), [])
  const [editing, setEditing] = useState<Topic | 'new' | null>(null)
  const [logging, setLogging] = useState<Topic | null>(null)
  const { run, error } = useAction()

  const setStatus = (t: Topic, status: TopicStatus) =>
    run(() => api.study.updateTopic(t.id, { ...t, status })).then((ok) => ok && topics.reload())

  return (
    <>
      <div className="toolbar end">
        <button className="btn primary" onClick={() => setEditing('new')}><Icon name="plus" size={16} /> Тема</button>
      </div>
      <ErrorNote error={topics.error ?? error} />
      {topics.data && topics.data.length === 0 && (
        <Empty>Добавь темы или курсы, которые хочешь изучить: цель в часах и дедлайн помогут видеть прогресс.</Empty>
      )}
      <div className="topic-grid">
        {topics.data?.map((t) => {
          const hours = t.spent_minutes / 60
          const pct = t.target_hours ? Math.min(100, (hours / t.target_hours) * 100) : null
          const overdue = t.deadline && t.status !== 'done' && t.deadline < today()
          return (
            <Card key={t.id} className={`topic status-${t.status}`}>
              <div className="topic-head">
                <div>
                  <h3>{t.title}</h3>
                  <span className={`area-tag area-${t.area}`}>{AREAS[t.area]}</span>
                </div>
                <button className="icon-btn" onClick={() => setEditing(t)} aria-label="Изменить"><Icon name="edit" size={16} /></button>
              </div>
              {t.description && <p className="muted small pre">{t.description}</p>}
              <div className="progress-line">
                <span><strong>{formatMinutes(t.spent_minutes)}</strong>{t.target_hours ? ` из ${t.target_hours} ч` : ''}</span>
                {t.deadline && (
                  <span className={overdue ? 'text-danger' : 'muted'}>до {formatDate(t.deadline, { day: 'numeric', month: 'short' })}</span>
                )}
              </div>
              {pct !== null && (
                <div className="progress" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
                  <div style={{ width: `${pct}%` }} />
                </div>
              )}
              <div className="topic-actions">
                <select value={t.status} onChange={(e) => setStatus(t, e.target.value as TopicStatus)} aria-label="Статус">
                  {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
                <button className="btn ghost small" onClick={() => setLogging(t)}><Icon name="clock" size={14} /> Записать время</button>
              </div>
            </Card>
          )
        })}
      </div>
      {editing && <TopicForm topic={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} onSaved={topics.reload} />}
      {logging && (
        <Modal title={`Время: ${logging.title}`} onClose={() => setLogging(null)}>
          <SessionForm topics={[logging]} fixedTopic={logging.id} onSaved={() => { setLogging(null); topics.reload() }} />
        </Modal>
      )}
    </>
  )
}

function TopicForm({ topic, onClose, onSaved }: { topic?: Topic; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState(topic?.title ?? '')
  const [description, setDescription] = useState(topic?.description ?? '')
  const [deadline, setDeadline] = useState(topic?.deadline ?? '')
  const [status, setStatus] = useState<TopicStatus>(topic?.status ?? 'todo')
  const [target, setTarget] = useState(topic?.target_hours?.toString() ?? '')
  const [area, setArea] = useState<Area>(topic?.area ?? 'logic')
  const { run, error, busy } = useAction()

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const body = { title, description, status, area, deadline: deadline || null, target_hours: target ? Number(target) : null }
    const ok = await run(() => (topic ? api.study.updateTopic(topic.id, body) : api.study.createTopic(body)))
    if (ok) { onSaved(); onClose() }
  }
  const remove = async () => {
    if (topic && await run(() => api.study.removeTopic(topic.id))) { onSaved(); onClose() }
  }

  return (
    <Modal title={topic ? 'Тема' : 'Новая тема'} onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <label>Название<input autoFocus required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Go: конкурентность" /></label>
        <AreaSelect value={area} onChange={setArea} />
        <label>Описание / ресурсы
          <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Книги, курсы, ссылки" />
        </label>
        <div className="row">
          <label>Цель, часов<input type="number" min={0.5} step={0.5} value={target} onChange={(e) => setTarget(e.target.value)} /></label>
          <label>Дедлайн<input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} /></label>
          <label>Статус
            <select value={status} onChange={(e) => setStatus(e.target.value as TopicStatus)}>
              {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
        </div>
        {topic && <p className="muted small">Удаление темы сохранит записанное время, но без привязки к теме.</p>}
        <ErrorNote error={error} />
        <div className="form-actions">
          {topic && <button type="button" className="btn danger" onClick={remove}>Удалить</button>}
          <div className="spacer" />
          <button type="button" className="btn ghost" onClick={onClose}>Отмена</button>
          <button className="btn primary" disabled={busy}>Сохранить</button>
        </div>
      </form>
    </Modal>
  )
}

// ================= Учёт времени =================

export function SessionForm({ topics, fixedTopic, defaultDate, onSaved }: {
  topics: Topic[]; fixedTopic?: number; defaultDate?: string; onSaved: () => void
}) {
  const [date, setDate] = useState(defaultDate ?? today())
  const [topicId, setTopicId] = useState<string>(fixedTopic?.toString() ?? '')
  const [hours, setHours] = useState('')
  const [minutes, setMinutes] = useState('')
  const [note, setNote] = useState('')
  const { run, error, busy } = useAction()

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const total = (Number(hours) || 0) * 60 + (Number(minutes) || 0)
    const ok = await run(() => api.study.createSession({
      date, minutes: total, note, topic_id: topicId ? Number(topicId) : null,
    }))
    if (ok) { setHours(''); setMinutes(''); setNote(''); onSaved() }
  }

  return (
    <form className="form" onSubmit={submit}>
      <div className="row">
        <label>Дата<input type="date" required value={date} onChange={(e) => setDate(e.target.value)} /></label>
        {!fixedTopic && (
          <label>Тема
            <select value={topicId} onChange={(e) => setTopicId(e.target.value)}>
              <option value="">— без темы —</option>
              {topics.filter((t) => t.status !== 'done').map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
            </select>
          </label>
        )}
      </div>
      <div className="row">
        <label>Часы<input type="number" min={0} max={24} value={hours} onChange={(e) => setHours(e.target.value)} placeholder="0" /></label>
        <label>Минуты<input type="number" min={0} max={59} value={minutes} onChange={(e) => setMinutes(e.target.value)} placeholder="0" /></label>
      </div>
      <div className="chips">
        {[25, 45, 60, 90, 120].map((m) => (
          <button type="button" key={m} className="chip"
            onClick={() => { setHours(String(Math.floor(m / 60))); setMinutes(String(m % 60)) }}>{formatMinutes(m)}</button>
        ))}
      </div>
      <label>Что изучал<input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Необязательно" /></label>
      <ErrorNote error={error} />
      <div className="form-actions">
        <button className="btn primary" disabled={busy}>Записать</button>
      </div>
    </form>
  )
}

function TimeLog() {
  const [range, setRange] = useState<'14' | '30' | '90'>('14')
  const to = today()
  const from = addDays(to, -(Number(range) - 1))
  const topics = useLoad(() => api.study.topics(), [])
  const stats = useLoad(() => api.study.stats(from, to), [from, to])
  const sessions = useLoad(() => api.study.sessions(from, to), [from, to])
  const { run, error } = useAction()
  const reload = () => { stats.reload(); sessions.reload(); topics.reload() }

  const total = (stats.data ?? []).reduce((s, d) => s + d.minutes, 0)
  const activeDays = (stats.data ?? []).filter((d) => d.minutes > 0).length
  const todayMin = stats.data?.find((d) => d.date === to)?.minutes ?? 0

  return (
    <>
      <div className="study-layout">
        <Card title="Записать занятие"><SessionForm topics={topics.data ?? []} onSaved={reload} /></Card>
        <Card title="Статистика" action={
          <Tabs value={range} onChange={setRange} items={[['14', '14 дней'], ['30', '30 дней'], ['90', '90 дней']]} />
        }>
          <div className="stats">
            <div className="stat"><span className="stat-value">{formatMinutes(todayMin)}</span><span className="stat-label">сегодня</span></div>
            <div className="stat"><span className="stat-value">{formatMinutes(total)}</span><span className="stat-label">за период</span></div>
            <div className="stat"><span className="stat-value">{formatMinutes(Math.round(total / Number(range)))}</span><span className="stat-label">в среднем в день</span></div>
            <div className="stat"><span className="stat-value">{activeDays}</span><span className="stat-label">дней с учёбой</span></div>
          </div>
          {stats.data && <StudyChart data={stats.data} />}
          <ErrorNote error={stats.error} />
        </Card>
      </div>
      <ErrorNote error={sessions.error ?? error} />
      {sessions.data && sessions.data.length === 0 && <Empty>За этот период занятий нет.</Empty>}
      {sessions.data && sessions.data.length > 0 && (
        <Card title="История занятий">
          {groupBy(sessions.data, (s) => s.date).map(([date, list]) => (
            <div key={date} className="day-group">
              <div className="day-group-head">
                <span>{relativeDay(date)}</span>
                <span className="muted small">{formatMinutes(list.reduce((s, x) => s + x.minutes, 0))}</span>
              </div>
              <ul className="entry-list">
                {list.map((s) => (
                  <li key={s.id} className="entry">
                    <span className="tag study">{formatMinutes(s.minutes)}</span>
                    <div className="entry-text">
                      {s.topic_title && <strong>{s.topic_title}</strong>}
                      {s.topic_title && s.note && ' · '}
                      {s.note || (!s.topic_title && <span className="muted">без темы</span>)}
                    </div>
                    <div className="entry-actions">
                      <ConfirmDelete onConfirm={() => run(() => api.study.removeSession(s.id)).then((ok) => ok && reload())} />
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </Card>
      )}
    </>
  )
}

