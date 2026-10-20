import { FormEvent, useState } from 'react'
import { api, Area, Book, BookStatus } from '../api'
import { Card, ConfirmDelete, Empty, ErrorNote, Icon, Modal, Tabs, useAction, useLoad } from '../components/ui'
import { AREAS, BOOK_STATUS, formatDate, today } from '../utils'
import { AreaSelect } from '../components/AreaSelect'

type Filter = 'all' | BookStatus

export function BooksTab() {
  const books = useLoad(() => api.books.list(), [])
  const [filter, setFilter] = useState<Filter>('all')
  const [editing, setEditing] = useState<Book | 'new' | null>(null)
  const list = (books.data ?? []).filter((b) => filter === 'all' || b.status === filter)
  const count = (s: BookStatus) => (books.data ?? []).filter((b) => b.status === s).length
  const doneThisYear = (books.data ?? []).filter((b) => b.status === 'done' && b.finished_on?.startsWith(today().slice(0, 4))).length

  return (
    <>
      <div className="stats">
        <div className="stat"><span className="stat-value">{count('reading')}</span><span className="stat-label">читаю сейчас</span></div>
        <div className="stat"><span className="stat-value">{count('done')}</span><span className="stat-label">прочитано всего</span></div>
        <div className="stat"><span className="stat-value">{doneThisYear}</span><span className="stat-label">прочитано в этом году</span></div>
        <div className="stat"><span className="stat-value">{count('want')}</span><span className="stat-label">в списке «хочу»</span></div>
      </div>
      <div className="toolbar">
        <Tabs value={filter} onChange={setFilter}
          items={[['all', 'Все'], ['reading', 'Читаю'], ['want', 'Хочу прочитать'], ['done', 'Прочитано']]} />
        <div className="spacer" />
        <button className="btn primary" onClick={() => setEditing('new')}><Icon name="plus" size={16} /> Книга</button>
      </div>
      <ErrorNote error={books.error} />
      {books.data && list.length === 0 && (
        <Empty>
          {filter === 'all'
            ? 'Добавь книги, которые читаешь или хочешь прочитать. Каждая прочитанная книга даёт опыт мозгу.'
            : 'Здесь пока пусто.'}
        </Empty>
      )}
      <div className="book-grid">
        {list.map((b) => <BookCard key={b.id} book={b} onEdit={() => setEditing(b)} onChange={books.reload} />)}
      </div>
      {editing && (
        <BookForm book={editing === 'new' ? undefined : editing}
          defaultStatus={filter === 'all' ? 'reading' : filter}
          onClose={() => setEditing(null)} onSaved={books.reload} />
      )}
    </>
  )
}

function BookCard({ book: b, onEdit, onChange }: { book: Book; onEdit: () => void; onChange: () => void }) {
  const { run, error } = useAction()
  const [pages, setPages] = useState('')
  const pct = b.pages ? Math.min(100, Math.round((b.pages_read / b.pages) * 100)) : null
  const save = (patch: Partial<Book>) => run(() => api.books.update(b.id, { ...b, ...patch })).then((ok) => ok && onChange())

  return (
    <Card className={`book status-${b.status}`}>
      <div className="topic-head">
        <div>
          <h3>{b.title}</h3>
          {b.author && <div className="muted small">{b.author}</div>}
        </div>
        <button className="icon-btn" onClick={onEdit} aria-label="Изменить"><Icon name="edit" size={16} /></button>
      </div>
      <div className="book-tags">
        <span className={`area-tag area-${b.area}`}>{AREAS[b.area]}</span>
        <span className={`pill book-status-${b.status}`}>{BOOK_STATUS[b.status]}</span>
        {b.rating && <span className="stars" aria-label={`Оценка ${b.rating} из 5`}>{'★'.repeat(b.rating)}<span className="stars-off">{'★'.repeat(5 - b.rating)}</span></span>}
      </div>

      {b.status === 'reading' && (
        <>
          <div className="progress-line">
            <span><strong>{b.pages_read}</strong>{b.pages ? ` из ${b.pages} стр.` : ' стр.'}</span>
            {pct !== null && <span className="muted">{pct}%</span>}
          </div>
          {pct !== null && <div className="progress"><div style={{ width: `${pct}%` }} /></div>}
          <form className="quick-add" onSubmit={(e) => {
            e.preventDefault()
            const n = Number(pages)
            if (n > 0) save({ pages_read: Math.min(b.pages ?? Infinity, n) }).then(() => setPages(''))
          }}>
            <input type="number" min={0} max={b.pages ?? undefined} value={pages} onChange={(e) => setPages(e.target.value)}
              placeholder="На какой я странице?" />
            <button className="btn ghost small">OK</button>
          </form>
          <button className="btn primary small" onClick={() => save({ status: 'done', finished_on: today() })}>
            <Icon name="check" size={14} /> Дочитал
          </button>
        </>
      )}
      {b.status === 'want' && (
        <button className="btn ghost small" onClick={() => save({ status: 'reading' })}>Начать читать</button>
      )}
      {b.status === 'done' && b.finished_on && (
        <div className="muted small">Прочитана {formatDate(b.finished_on, { day: 'numeric', month: 'long', year: 'numeric' })}
          {b.pages ? ` · ${b.pages} стр.` : ''}</div>
      )}
      {b.notes && <p className="muted small pre book-notes">{b.notes}</p>}
      <ErrorNote error={error} />
    </Card>
  )
}

function BookForm({ book, defaultStatus, onClose, onSaved }: {
  book?: Book; defaultStatus: BookStatus; onClose: () => void; onSaved: () => void
}) {
  const [f, setF] = useState({
    title: book?.title ?? '', author: book?.author ?? '', area: book?.area ?? ('logic' as Area),
    status: book?.status ?? defaultStatus, pages: book?.pages?.toString() ?? '', pages_read: book?.pages_read?.toString() ?? '',
    finished_on: book?.finished_on ?? '', rating: book?.rating ?? 0, notes: book?.notes ?? '',
  })
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }))
  const { run, error, busy } = useAction()

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const body = {
      title: f.title, author: f.author, area: f.area, status: f.status, notes: f.notes,
      pages: f.pages ? Number(f.pages) : null, pages_read: Number(f.pages_read) || 0,
      finished_on: f.status === 'done' ? (f.finished_on || today()) : null,
      rating: f.rating || null,
    }
    const ok = await run(() => (book ? api.books.update(book.id, body) : api.books.create(body)))
    if (ok) { onSaved(); onClose() }
  }

  return (
    <Modal title={book ? 'Книга' : 'Новая книга'} onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <label>Название<input autoFocus required value={f.title} onChange={(e) => set('title', e.target.value)} /></label>
        <div className="row">
          <label>Автор<input value={f.author} onChange={(e) => set('author', e.target.value)} /></label>
          <label>Страниц<input type="number" min={1} value={f.pages} onChange={(e) => set('pages', e.target.value)} /></label>
        </div>
        <AreaSelect value={f.area} onChange={(a) => set('area', a)} />
        <div className="field">
          <span className="field-label">Статус</span>
          <Tabs value={f.status} onChange={(s) => set('status', s)}
            items={[['want', 'Хочу прочитать'], ['reading', 'Читаю'], ['done', 'Прочитано']]} />
        </div>
        {f.status === 'reading' && (
          <label>Прочитано страниц<input type="number" min={0} value={f.pages_read} onChange={(e) => set('pages_read', e.target.value)} /></label>
        )}
        {f.status === 'done' && (
          <div className="row">
            <label>Дочитал<input type="date" value={f.finished_on} onChange={(e) => set('finished_on', e.target.value)} /></label>
            <div className="field">
              <span className="field-label">Оценка</span>
              <div className="star-input" role="radiogroup" aria-label="Оценка">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button type="button" key={n} role="radio" aria-checked={f.rating === n} aria-label={`${n}`}
                    className={n <= f.rating ? 'on' : ''} onClick={() => set('rating', f.rating === n ? 0 : n)}>★</button>
                ))}
              </div>
            </div>
          </div>
        )}
        <label>Заметки<textarea rows={3} value={f.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Главные мысли, цитаты" /></label>
        <ErrorNote error={error} />
        <div className="form-actions">
          {book && <ConfirmDelete label="Удалить книгу" onConfirm={() => run(() => api.books.remove(book.id)).then((ok) => { if (ok) { onSaved(); onClose() } })} />}
          <div className="spacer" />
          <button type="button" className="btn ghost" onClick={onClose}>Отмена</button>
          <button className="btn primary" disabled={busy}>Сохранить</button>
        </div>
      </form>
    </Modal>
  )
}
