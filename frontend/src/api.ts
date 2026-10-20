// Типизированный клиент REST API бэкенда.

export type Parity = 'all' | 'odd' | 'even'
export type TopicStatus = 'todo' | 'in_progress' | 'done'
export type Area = 'logic' | 'humanities' | 'creative' | 'self'
export type BookStatus = 'want' | 'reading' | 'done'

export interface FoodEntry { id: number; date: string; time: string; content: string; created_at: string }
export interface Workout { id: number; date: string; kind: string; duration_min: number | null; note: string }
export interface Task {
  id: number; title: string; notes: string
  due_date: string | null; due_time: string | null
  priority: 1 | 2 | 3; done: boolean
}
export interface ClassItem {
  id: number; weekday: number; start_time: string; end_time: string
  subject: string; kind: string; room: string; teacher: string; parity: Parity
}
export interface Topic {
  id: number; title: string; description: string; deadline: string | null
  status: TopicStatus; target_hours: number | null; area: Area; spent_minutes: number
}
export interface StudySession {
  id: number; topic_id: number | null; topic_title: string | null
  date: string; minutes: number; note: string
}
export interface Book {
  id: number; title: string; author: string; area: Area; status: BookStatus
  pages: number | null; pages_read: number; finished_on: string | null; rating: number | null; notes: string
}
export type ZoneKey = 'frontal' | 'parietal' | 'temporal' | 'occipital' | 'cerebellum'
export interface BrainZone {
  key: ZoneKey; name: string; desc: string; xp: number
  level: number; level_from: number; level_to: number
  sources: { label: string; xp: number }[]
}
export interface Achievement { kind: 'skill' | 'book'; title: string; zone: ZoneKey; xp: number; date: string }
export interface Brain {
  total_xp: number; level: number; title: string; level_from: number; level_to: number
  zones: BrainZone[]; achievements: Achievement[]
  stats: { study_minutes: number; skills: number; books_done: number; books_reading: number; pages_read: number; tasks_done: number; workouts: number }
}
export interface DayMinutes { date: string; minutes: number }
export interface Settings { semester_start: string | null; study_goal_min: number }
export interface ProductivityDay {
  date: string; score: number
  parts: { tasks: number; study: number; workout: number }
  tasks_planned: number; tasks_done: number; study_minutes: number; workouts: number
}
export interface Productivity { study_goal_min: number; days: ProductivityDay[] }
export interface DayOverview {
  date: string; weekday: number; week_number: number | null; parity: 'odd' | 'even' | null
  classes: ClassItem[]; tasks: Task[]; food: FoodEntry[]; workouts: Workout[]; study_minutes: number
}
export interface CalendarDay {
  date: string; tasks_open: number; tasks_done: number
  workouts: number; food_entries: number; study_minutes: number
}

export type Input<T> = Omit<T, 'id'>

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

// При 401 приложение показывает экран входа (сессия истекла или пользователь вышел).
export const UNAUTHORIZED_EVENT = 'lifehub:unauthorized'
// После любого успешного изменения данных открытые экраны перезагружают свои данные.
export const DATA_CHANGED_EVENT = 'lifehub:data-changed'

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (res.status === 204) {
    if (method !== 'GET' && !path.startsWith('/auth/')) changed()
    return undefined as T
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/auth/')) window.dispatchEvent(new Event(UNAUTHORIZED_EVENT))
    throw new ApiError(res.status, translateError(data.error ?? `HTTP ${res.status}`))
  }
  if (method !== 'GET' && !path.startsWith('/auth/')) changed()
  return data as T
}

function changed() { window.dispatchEvent(new Event(DATA_CHANGED_EVENT)) }

// Сообщения бэкенда об аккаунтах — по-русски.
const ERRORS: Record<string, string> = {
  'wrong username or password': 'Неверный логин или пароль',
  'username is taken': 'Такой логин уже занят',
  'invite is invalid or expired': 'Приглашение недействительно или истекло',
  'password must be at least 8 characters': 'Пароль — минимум 8 символов',
  'current password is wrong': 'Текущий пароль указан неверно',
  'too many attempts, try again later': 'Слишком много попыток, попробуй через 10 минут',
  'name is required (up to 50 characters)': 'Укажи имя (до 50 символов)',
  'username: 3–32 characters, latin letters, digits, _ . -': 'Логин: 3–32 символа — латиница, цифры, _ . -',
}
const translateError = (m: string) => ERRORS[m] ?? m

export interface User { id: number; username: string; name: string; is_admin: boolean }
export interface Invite { code: string; created_at: string; expires_at: string; used_by: string | null }

const qs = (p: Record<string, string | undefined>) => {
  const s = new URLSearchParams()
  Object.entries(p).forEach(([k, v]) => v && s.set(k, v))
  const str = s.toString()
  return str ? `?${str}` : ''
}

export const api = {
  auth: {
    status: () => request<{ has_users: boolean }>('GET', '/auth/status'),
    me: () => request<User>('GET', '/auth/me'),
    login: (username: string, password: string) => request<User>('POST', '/auth/login', { username, password }),
    register: (b: { invite?: string; username: string; name: string; password: string }) => request<User>('POST', '/auth/register', b),
    logout: () => request<void>('POST', '/auth/logout'),
    changePassword: (current: string, next: string) => request<void>('PUT', '/auth/password', { current, new: next }),
  },
  invites: {
    list: () => request<Invite[]>('GET', '/invites'),
    create: () => request<Invite>('POST', '/invites'),
    remove: (code: string) => request<void>('DELETE', `/invites/${encodeURIComponent(code)}`),
    check: (code: string) => request<{ from: string }>('GET', `/invites/${encodeURIComponent(code)}`),
  },
  food: {
    list: (from?: string, to?: string) => request<FoodEntry[]>('GET', `/food${qs({ from, to })}`),
    create: (e: Omit<FoodEntry, 'id' | 'created_at'>) => request<FoodEntry>('POST', '/food', e),
    update: (id: number, e: Omit<FoodEntry, 'id' | 'created_at'>) => request<FoodEntry>('PUT', `/food/${id}`, e),
    remove: (id: number) => request<void>('DELETE', `/food/${id}`),
    exportUrl: (from?: string, to?: string) => `/api/food/export${qs({ from, to })}`,
  },
  workouts: {
    list: (from?: string, to?: string) => request<Workout[]>('GET', `/workouts${qs({ from, to })}`),
    kinds: () => request<string[]>('GET', '/workouts/kinds'),
    create: (w: Input<Workout>) => request<Workout>('POST', '/workouts', w),
    update: (id: number, w: Input<Workout>) => request<Workout>('PUT', `/workouts/${id}`, w),
    remove: (id: number) => request<void>('DELETE', `/workouts/${id}`),
  },
  tasks: {
    range: (from: string, to: string) => request<Task[]>('GET', `/tasks${qs({ from, to })}`),
    undated: () => request<Task[]>('GET', '/tasks?undated=true'),
    overdue: () => request<Task[]>('GET', '/tasks?overdue=true'),
    create: (t: Input<Task>) => request<Task>('POST', '/tasks', t),
    update: (id: number, t: Input<Task>) => request<Task>('PUT', `/tasks/${id}`, t),
    toggle: (id: number) => request<Task>('PATCH', `/tasks/${id}/toggle`),
    remove: (id: number) => request<void>('DELETE', `/tasks/${id}`),
  },
  classes: {
    list: () => request<ClassItem[]>('GET', '/classes'),
    create: (c: Input<ClassItem>) => request<ClassItem>('POST', '/classes', c),
    update: (id: number, c: Input<ClassItem>) => request<ClassItem>('PUT', `/classes/${id}`, c),
    remove: (id: number) => request<void>('DELETE', `/classes/${id}`),
  },
  study: {
    topics: () => request<Topic[]>('GET', '/study/topics'),
    createTopic: (t: Omit<Topic, 'id' | 'spent_minutes'>) => request<Topic>('POST', '/study/topics', t),
    updateTopic: (id: number, t: Omit<Topic, 'id' | 'spent_minutes'>) => request<Topic>('PUT', `/study/topics/${id}`, t),
    removeTopic: (id: number) => request<void>('DELETE', `/study/topics/${id}`),
    sessions: (from?: string, to?: string) => request<StudySession[]>('GET', `/study/sessions${qs({ from, to })}`),
    createSession: (s: { topic_id: number | null; date: string; minutes: number; note: string }) =>
      request<StudySession>('POST', '/study/sessions', s),
    removeSession: (id: number) => request<void>('DELETE', `/study/sessions/${id}`),
    stats: (from: string, to: string) => request<DayMinutes[]>('GET', `/study/stats${qs({ from, to })}`),
  },
  books: {
    list: () => request<Book[]>('GET', '/books'),
    create: (b: Input<Book>) => request<Book>('POST', '/books', b),
    update: (id: number, b: Input<Book>) => request<Book>('PUT', `/books/${id}`, b),
    remove: (id: number) => request<void>('DELETE', `/books/${id}`),
  },
  brain: () => request<Brain>('GET', '/brain'),
  settings: {
    get: () => request<Settings>('GET', '/settings'),
    put: (s: Partial<Settings>) => request<Settings>('PUT', '/settings', s),
  },
  day: (date: string) => request<DayOverview>('GET', `/day?date=${date}`),
  productivity: (from: string, to: string) => request<Productivity>('GET', `/productivity${qs({ from, to })}`),
  calendar: (month: string) => request<CalendarDay[]>('GET', `/calendar?month=${month}`),
}
