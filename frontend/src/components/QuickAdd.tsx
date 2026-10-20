import { useState } from 'react'
import { api } from '../api'
import { FoodForm } from '../pages/Food'
import { SessionForm } from '../pages/Study'
import { WorkoutForm } from '../pages/Workouts'
import { today } from '../utils'
import { TaskForm } from './Tasks'
import { Icon, Modal, toast, useLoad } from './ui'

export type QuickKind = 'food' | 'task' | 'study' | 'workout'

const OPTIONS: { kind: QuickKind; label: string; hint: string; icon: string; cls: string }[] = [
  { kind: 'food', label: 'Еда', hint: 'что съел', icon: 'food', cls: 'qa-food' },
  { kind: 'task', label: 'Задача', hint: 'что сделать', icon: 'check', cls: 'qa-task' },
  { kind: 'study', label: 'Учёба', hint: 'сколько занимался', icon: 'book', cls: 'qa-study' },
  { kind: 'workout', label: 'Тренировка', hint: 'что делал', icon: 'dumbbell', cls: 'qa-workout' },
]

// Быстрое добавление: меню из 4 крупных кнопок → короткая форма в шторке.
export function QuickAdd({ initial, onClose }: { initial?: QuickKind; onClose: () => void }) {
  const [kind, setKind] = useState<QuickKind | null>(initial ?? null)
  const done = (msg: string) => { toast(msg); onClose() }

  if (kind === 'task') {
    return <TaskForm defaultDate={today()} onClose={onClose} onSaved={() => toast('Задача добавлена')} />
  }
  if (kind === 'food') {
    return (
      <Modal title="Что съел?" onClose={onClose}>
        <FoodForm defaultDate={today()} quick onSaved={() => done('Записано в дневник питания')} />
      </Modal>
    )
  }
  if (kind === 'study') return <QuickStudy onClose={onClose} onDone={() => done('Время учёбы записано')} />
  if (kind === 'workout') {
    return (
      <Modal title="Тренировка" onClose={onClose}>
        <WorkoutForm defaultDate={today()} onSaved={() => done('Тренировка записана')} />
      </Modal>
    )
  }
  return (
    <Modal title="Добавить" onClose={onClose}>
      <div className="qa-grid">
        {OPTIONS.map((o) => (
          <button key={o.kind} className={`qa-btn ${o.cls}`} onClick={() => setKind(o.kind)}>
            <span className="qa-icon"><Icon name={o.icon} size={22} /></span>
            <span className="qa-label">{o.label}</span>
            <span className="qa-hint">{o.hint}</span>
          </button>
        ))}
      </div>
    </Modal>
  )
}

function QuickStudy({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const topics = useLoad(() => api.study.topics(), [])
  return (
    <Modal title="Время учёбы" onClose={onClose}>
      <SessionForm topics={topics.data ?? []} defaultDate={today()} onSaved={onDone} />
    </Modal>
  )
}
