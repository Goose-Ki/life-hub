import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { BrainCard } from '../components/brain/BrainView'
import { ProductivityCard } from '../components/Productivity'
import { QuickTask, TaskRow } from '../components/Tasks'
import { Card, Empty, ErrorNote, Icon, Modal, useLoad } from '../components/ui'
import { addDays, formatDate, formatMinutes, relativeDay, today } from '../utils'
import { FoodForm, FoodList } from './Food'
import { SessionForm } from './Study'
import { WorkoutForm, WorkoutList } from './Workouts'

export default function TodayPage() {
  const [date, setDate] = useState(today())
  const day = useLoad(() => api.day(date), [date])
  const topics = useLoad(() => api.study.topics(), [])
  const [modal, setModal] = useState<'workout' | 'study' | null>(null)
  const d = day.data
  const now = new Date().toTimeString().slice(0, 5)
  const isToday = date === today()
  const openTasks = d?.tasks.filter((t) => !t.done).length ?? 0

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>{relativeDay(date) === formatDate(date) ? formatDate(date, { day: 'numeric', month: 'long' }) : relativeDay(date)}</h1>
          <div className="muted">
            {formatDate(date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            {d?.week_number && ` · ${d.week_number}-я учебная неделя (${d.parity === 'odd' ? 'верхняя' : 'нижняя'})`}
          </div>
        </div>
        <div className="date-nav">
          <button className="icon-btn" onClick={() => setDate(addDays(date, -1))} aria-label="Предыдущий день"><Icon name="left" /></button>
          <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="Выбрать дату" />
          <button className="icon-btn" onClick={() => setDate(addDays(date, 1))} aria-label="Следующий день"><Icon name="right" /></button>
          {!isToday && <button className="btn ghost small" onClick={() => setDate(today())}>Сегодня</button>}
        </div>
      </header>
      <ErrorNote error={day.error} />

      {d && (
        <div className="stats">
          <div className="stat"><span className="stat-value">{d.classes.length}</span><span className="stat-label">пар</span></div>
          <div className="stat"><span className="stat-value">{openTasks}</span><span className="stat-label">задач осталось</span></div>
          <div className="stat"><span className="stat-value">{formatMinutes(d.study_minutes)}</span><span className="stat-label">учёба</span></div>
          <div className="stat"><span className="stat-value">{d.workouts.length ? 'Да' : '—'}</span><span className="stat-label">тренировка</span></div>
        </div>
      )}

      {d && (
        <div className="dashboard">
          {isToday && <ProductivityCard refreshKey={JSON.stringify([d.tasks.map((t) => t.done), d.study_minutes, d.workouts.length])} />}
          <BrainCard refreshKey={JSON.stringify([d.tasks.map((t) => t.done), d.study_minutes, d.workouts.length])} />
          <Card title="Пары" action={<Link className="link small" to="/study?tab=schedule">Расписание</Link>}>
            {d.classes.length === 0 ? <Empty>Пар нет</Empty> : (
              <ul className="class-list">
                {d.classes.map((c) => {
                  const state = !isToday ? '' : now >= c.end_time ? 'past' : now >= c.start_time ? 'now' : ''
                  return (
                    <li key={c.id} className={state}>
                      <div className="class-time">{c.start_time}<br /><span className="muted">{c.end_time}</span></div>
                      <div>
                        <div className="class-subject">{c.subject}{state === 'now' && <span className="pill live">идёт</span>}</div>
                        <div className="muted small">{[c.kind, c.room, c.teacher].filter(Boolean).join(' · ')}</div>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </Card>

          <Card title="Задачи" action={<Link className="link small" to="/calendar">Календарь</Link>}>
            <ul className="task-list">
              {d.tasks.map((t) => <TaskRow key={t.id} task={t} onChange={day.reload} />)}
            </ul>
            <QuickTask date={date} onAdded={day.reload} />
          </Card>

          <Card title="Питание" className="span-2">
            {d.food.length > 0 && <FoodList entries={d.food} onChange={day.reload} />}
            <FoodForm key={date} defaultDate={date} compact onSaved={day.reload} />
          </Card>

          <Card title="Тренировка" action={
            <button className="icon-btn accent" onClick={() => setModal('workout')} aria-label="Добавить тренировку"><Icon name="plus" /></button>
          }>
            {d.workouts.length === 0 ? <Empty>Тренировок не записано</Empty> : <WorkoutList items={d.workouts} onChange={day.reload} />}
          </Card>

          <Card title="Учёба" action={
            <button className="icon-btn accent" onClick={() => setModal('study')} aria-label="Записать время учёбы"><Icon name="plus" /></button>
          }>
            <div className="big-number">{formatMinutes(d.study_minutes)}</div>
            <div className="muted small">
              {topics.data?.filter((t) => t.status === 'in_progress').map((t) => t.title).join(', ') || 'Нет тем в процессе'}
            </div>
            <Link className="link small" to="/study?tab=time">Статистика →</Link>
          </Card>
        </div>
      )}

      {modal === 'workout' && (
        <Modal title="Тренировка" onClose={() => setModal(null)}>
          <WorkoutForm defaultDate={date} onSaved={() => { setModal(null); day.reload() }} onCancel={() => setModal(null)} />
        </Modal>
      )}
      {modal === 'study' && (
        <Modal title="Время учёбы" onClose={() => setModal(null)}>
          <SessionForm topics={topics.data ?? []} defaultDate={date} onSaved={() => { setModal(null); day.reload(); topics.reload() }} />
        </Modal>
      )}
    </div>
  )
}
