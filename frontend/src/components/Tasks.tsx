import { FormEvent, useState } from 'react'
import { api, Task } from '../api'
import { PRIORITY, relativeDay } from '../utils'
import { ConfirmDelete, ErrorNote, Icon, Modal, useAction } from './ui'

export function TaskRow({ task, onChange, showDate = false }: {
  task: Task; onChange: () => void; showDate?: boolean
}) {
  const [editing, setEditing] = useState(false)
  const { run, error } = useAction()
  return (
    <li className={`task-row ${task.done ? 'done' : ''}`}>
      <button className={`check ${task.done ? 'checked' : ''}`} aria-label={task.done ? 'Вернуть в работу' : 'Выполнено'}
        onClick={() => run(() => api.tasks.toggle(task.id)).then((ok) => ok && onChange())}>
        {task.done && <Icon name="check" size={14} />}
      </button>
      <div className="task-main" onClick={() => setEditing(true)}>
        <div className="task-title">
          {task.priority === 1 && <span className="prio-high" title="Высокий приоритет">!</span>}
          {task.title}
        </div>
        {(task.due_time || task.notes || (showDate && task.due_date)) && (
          <div className="muted small">
            {showDate && task.due_date && <span>{relativeDay(task.due_date)} </span>}
            {task.due_time && <span><Icon name="clock" size={12} /> {task.due_time} </span>}
            {task.notes && <span className="ellipsis">{task.notes}</span>}
          </div>
        )}
        <ErrorNote error={error} />
      </div>
      <ConfirmDelete onConfirm={() => run(() => api.tasks.remove(task.id)).then((ok) => ok && onChange())} />
      {editing && <TaskForm task={task} onClose={() => setEditing(false)} onSaved={onChange} />}
    </li>
  )
}

export function TaskForm({ task, defaultDate, onClose, onSaved }: {
  task?: Task; defaultDate?: string | null; onClose: () => void; onSaved: () => void
}) {
  const [title, setTitle] = useState(task?.title ?? '')
  const [notes, setNotes] = useState(task?.notes ?? '')
  const [date, setDate] = useState(task?.due_date ?? defaultDate ?? '')
  const [time, setTime] = useState(task?.due_time ?? '')
  const [priority, setPriority] = useState<1 | 2 | 3>(task?.priority ?? 2)
  const { run, error, busy } = useAction()

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const body = {
      title, notes, priority, done: task?.done ?? false,
      due_date: date || null, due_time: date && time ? time : null,
    }
    const ok = await run(() => (task ? api.tasks.update(task.id, body) : api.tasks.create(body)))
    if (ok) { onSaved(); onClose() }
  }

  return (
    <Modal title={task ? 'Задача' : 'Новая задача'} onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <label>Название
          <input autoFocus required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Что нужно сделать?" />
        </label>
        <div className="row">
          <label>Дата
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label>Время
            <input type="time" value={time} disabled={!date} onChange={(e) => setTime(e.target.value)} />
          </label>
          <label>Приоритет
            <select value={priority} onChange={(e) => setPriority(Number(e.target.value) as 1 | 2 | 3)}>
              {[1, 2, 3].map((p) => <option key={p} value={p}>{PRIORITY[p]}</option>)}
            </select>
          </label>
        </div>
        <label>Заметки
          <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
        <ErrorNote error={error} />
        <div className="form-actions">
          <button type="button" className="btn ghost" onClick={onClose}>Отмена</button>
          <button className="btn primary" disabled={busy}>Сохранить</button>
        </div>
      </form>
    </Modal>
  )
}

// Быстрое добавление задачи одной строкой.
export function QuickTask({ date, onAdded }: { date: string | null; onAdded: () => void }) {
  const [title, setTitle] = useState('')
  const { run, error, busy } = useAction()
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return
    const ok = await run(() => api.tasks.create({
      title, notes: '', due_date: date, due_time: null, priority: 2, done: false,
    }))
    if (ok) { setTitle(''); onAdded() }
  }
  return (
    <form className="quick-add" onSubmit={submit}>
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Добавить задачу…" />
      <button className="icon-btn accent" disabled={busy} aria-label="Добавить"><Icon name="plus" /></button>
      <ErrorNote error={error} />
    </form>
  )
}
