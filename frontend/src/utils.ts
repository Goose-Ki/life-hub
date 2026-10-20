// Даты храним строками YYYY-MM-DD в локальном времени.

const pad = (n: number) => String(n).padStart(2, '0')

export const toISO = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
export const fromISO = (s: string) => {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}
export const today = () => toISO(new Date())
export const addDays = (s: string, n: number) => {
  const d = fromISO(s)
  d.setDate(d.getDate() + n)
  return toISO(d)
}

export const WEEKDAYS = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье']
export const WEEKDAYS_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']

export const PRIORITY: Record<number, string> = { 1: 'Высокий', 2: 'Обычный', 3: 'Низкий' }
export const STATUS: Record<string, string> = { todo: 'В планах', in_progress: 'В процессе', done: 'Готово' }
export const AREAS: Record<string, string> = {
  logic: 'Логика и технологии', humanities: 'Языки и гуманитарное', creative: 'Творчество', self: 'Саморазвитие',
}
export const BOOK_STATUS: Record<string, string> = { want: 'Хочу прочитать', reading: 'Читаю', done: 'Прочитано' }
export const PARITY: Record<string, string> = { all: 'Каждую неделю', odd: 'Верхняя', even: 'Нижняя' }

export function formatDate(s: string, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long', weekday: 'long' }) {
  return fromISO(s).toLocaleDateString('ru-RU', opts)
}

export function relativeDay(s: string) {
  const t = today()
  if (s === t) return 'Сегодня'
  if (s === addDays(t, -1)) return 'Вчера'
  if (s === addDays(t, 1)) return 'Завтра'
  return formatDate(s)
}

export function formatMinutes(m: number) {
  const h = Math.floor(m / 60)
  const mm = m % 60
  if (!h) return `${mm} мин`
  return mm ? `${h} ч ${mm} мин` : `${h} ч`
}

export function groupBy<T>(items: T[], key: (t: T) => string): [string, T[]][] {
  const map = new Map<string, T[]>()
  for (const it of items) {
    const k = key(it)
    if (!map.has(k)) map.set(k, [])
    map.get(k)!.push(it)
  }
  return [...map.entries()]
}

// Верхняя (нечётная) / нижняя (чётная) неделя от даты начала семестра (как на бэкенде).
export function weekInfo(date: string, semesterStart: string | null) {
  if (!semesterStart) return null
  const monday = (s: string) => {
    const d = fromISO(s)
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
    return d
  }
  const days = Math.round((monday(date).getTime() - monday(semesterStart).getTime()) / 86400000)
  if (days < 0) return null
  const n = Math.floor(days / 7) + 1
  return { number: n, parity: (n % 2 === 1 ? 'odd' : 'even') as 'odd' | 'even' }
}
