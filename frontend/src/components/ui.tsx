import { ReactNode, TouchEvent, useCallback, useEffect, useRef, useState } from 'react'
import { DATA_CHANGED_EVENT } from '../api'

// Загрузка данных с перезапросом: const { data, reload } = useLoad(() => api.x(), [deps])
// Сам обновляется, когда данные где-то изменились (например, через быстрое добавление)
// и когда приложение снова открывают на телефоне после перерыва.
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const seq = useRef(0)

  const reload = useCallback(() => {
    const id = ++seq.current
    setLoading(true)
    fn()
      .then((d) => { if (id === seq.current) { setData(d); setError(null) } })
      .catch((e: Error) => { if (id === seq.current) setError(e.message) })
      .finally(() => { if (id === seq.current) setLoading(false) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  useEffect(reload, [reload])

  const loadedAt = useRef(Date.now())
  useEffect(() => { if (!loading) loadedAt.current = Date.now() }, [loading])
  useEffect(() => {
    let t = 0
    const onChanged = () => { window.clearTimeout(t); t = window.setTimeout(reload, 120) }
    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - loadedAt.current > 30_000) reload()
    }
    window.addEventListener(DATA_CHANGED_EVENT, onChanged)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearTimeout(t)
      window.removeEventListener(DATA_CHANGED_EVENT, onChanged)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [reload])

  return { data, error, loading, reload, setData }
}

// Обёртка для мутаций: показывает ошибку, не роняя страницу.
export function useAction() {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const run = useCallback(async (fn: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
      return true
    } catch (e) {
      setError((e as Error).message)
      return false
    } finally {
      setBusy(false)
    }
  }, [])
  return { run, error, busy, setError }
}

export function ErrorNote({ error }: { error: string | null }) {
  if (!error) return null
  return <div className="error-note" role="alert">{error}</div>
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>
}

export function Card({ title, action, children, className = '' }: {
  title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string
}) {
  return (
    <section className={`card ${className}`}>
      {(title || action) && (
        <header className="card-head">
          {title && <h2>{title}</h2>}
          {action}
        </header>
      )}
      {children}
    </section>
  )
}

let openModals = 0

// На компьютере — окно по центру, на телефоне — шторка снизу (закрывается свайпом вниз).
export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const sheetRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ y: number; dy: number } | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    openModals++
    document.body.classList.add('modal-open') // фон не прокручивается под шторкой
    return () => {
      window.removeEventListener('keydown', onKey)
      if (--openModals === 0) document.body.classList.remove('modal-open')
    }
  }, [onClose])

  const onTouchStart = (e: TouchEvent) => { drag.current = { y: e.touches[0].clientY, dy: 0 } }
  const onTouchMove = (e: TouchEvent) => {
    if (!drag.current || !sheetRef.current) return
    drag.current.dy = Math.max(0, e.touches[0].clientY - drag.current.y)
    sheetRef.current.style.transform = `translateY(${drag.current.dy}px)`
  }
  const onTouchEnd = () => {
    const el = sheetRef.current
    if (!drag.current || !el) return
    if (drag.current.dy > 90) onClose()
    else { el.style.transition = 'transform .2s'; el.style.transform = ''; window.setTimeout(() => { el.style.transition = '' }, 200) }
    drag.current = null
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} ref={sheetRef}>
        <div className="sheet-grip" onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd} aria-hidden="true" />
        <header className="card-head" onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Закрыть"><Icon name="x" /></button>
        </header>
        {children}
      </div>
    </div>
  )
}

export function Tabs<T extends string>({ value, onChange, items }: {
  value: T; onChange: (v: T) => void; items: [T, string][]
}) {
  return (
    <div className="tabs" role="tablist">
      {items.map(([k, label]) => (
        <button key={k} type="button" role="tab" aria-selected={value === k} className={value === k ? 'active' : ''}
          onClick={() => onChange(k)}>{label}</button>
      ))}
    </div>
  )
}

const ICONS: Record<string, string> = {
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z',
  food: 'M7 3v8a2 2 0 0 0 2 2v8M5 3v5M9 3v5M17 3c-2 1-3 4-3 7h3v11',
  dumbbell: 'M6 7v10M3 9v6M18 7v10M21 9v6M6 12h12',
  calendar: 'M4 6a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1zM4 10h16M8 3v4M16 3v4',
  book: 'M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM4 21V5M8 7h7',
  plus: 'M12 5v14M5 12h14',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  user: 'M20 21a8 8 0 0 0-16 0M12 13a4 4 0 1 0 0-8 4 4 0 0 0 0 8',
  x: 'M6 6l12 12M18 6 6 18',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  edit: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4',
  left: 'M15 6l-6 6 6 6',
  right: 'M9 6l6 6-6 6',
  check: 'M5 12l5 5 9-11',
  clock: 'M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
  brain: 'M12 5a3 3 0 0 0-5.6-1.5A3 3 0 0 0 3.5 8a3 3 0 0 0 0 6 3 3 0 0 0 3 4.5A3 3 0 0 0 12 19zM12 5a3 3 0 0 1 5.6-1.5A3 3 0 0 1 20.5 8a3 3 0 0 1 0 6 3 3 0 0 1-3 4.5A3 3 0 0 1 12 19zM12 5v14',
  logout: 'M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 16l4-4-4-4M14 12H4',
  share: 'M12 3v12M7 8l5-5 5 5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6',
  download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  pin: 'M12 21s7-6.5 7-12a7 7 0 0 0-14 0c0 5.5 7 12 7 12zM12 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4',
}

// ---------- Всплывающее уведомление («Записано») ----------

const TOAST_EVENT = 'lifehub:toast'

export function toast(text: string) {
  window.dispatchEvent(new CustomEvent(TOAST_EVENT, { detail: text }))
  navigator.vibrate?.(10)
}

export function Toaster() {
  const [msg, setMsg] = useState<{ text: string; id: number } | null>(null)
  useEffect(() => {
    let t = 0
    const on = (e: Event) => {
      setMsg({ text: (e as CustomEvent<string>).detail, id: Date.now() })
      window.clearTimeout(t)
      t = window.setTimeout(() => setMsg(null), 2200)
    }
    window.addEventListener(TOAST_EVENT, on)
    return () => { window.removeEventListener(TOAST_EVENT, on); window.clearTimeout(t) }
  }, [])
  if (!msg) return null
  return <div key={msg.id} className="toast" role="status"><Icon name="check" size={16} /> {msg.text}</div>
}

// Мобильная раскладка (совпадает с CSS-брейкпоинтом)
export function useIsMobile() {
  const q = '(max-width: 760px)'
  const [m, setM] = useState(() => window.matchMedia(q).matches)
  useEffect(() => {
    const mq = window.matchMedia(q)
    const on = () => setM(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return m
}

export function Icon({ name, size = 18 }: { name: keyof typeof ICONS | string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={ICONS[name]} />
    </svg>
  )
}

export function ConfirmDelete({ onConfirm, label = 'Удалить' }: { onConfirm: () => void; label?: string }) {
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return
    const t = setTimeout(() => setArmed(false), 3000)
    return () => clearTimeout(t)
  }, [armed])
  return armed ? (
    <button className="btn danger small" onClick={onConfirm}>Точно?</button>
  ) : (
    <button className="icon-btn" onClick={() => setArmed(true)} aria-label={label} title={label}>
      <Icon name="trash" size={16} />
    </button>
  )
}
