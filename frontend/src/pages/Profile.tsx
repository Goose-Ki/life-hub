import { FormEvent, useState } from 'react'
import { api, Invite } from '../api'
import { useAuth } from '../components/auth'
import { Card, ConfirmDelete, Empty, ErrorNote, Icon, useAction, useLoad } from '../components/ui'
import { formatDate } from '../utils'

export default function ProfilePage() {
  const { user, logout } = useAuth()
  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>{user.name}</h1>
          <div className="muted">@{user.username}{user.is_admin ? ' · администратор' : ''}</div>
        </div>
        <button className="btn ghost" onClick={logout}><Icon name="logout" size={16} /> Выйти</button>
      </header>
      <div className="profile-grid">
        {user.is_admin && <Invites />}
        <InstallCard />
        <PasswordCard />
      </div>
    </div>
  )
}

function inviteLink(code: string) {
  return `${window.location.origin}/join/${code}`
}

function Invites() {
  const invites = useLoad(() => api.invites.list(), [])
  const { run, error, busy } = useAction()
  const [fresh, setFresh] = useState<Invite | null>(null)
  const [copied, setCopied] = useState(false)

  const create = () => run(async () => {
    const inv = await api.invites.create()
    setFresh(inv)
    setCopied(false)
    invites.reload()
  })

  const share = async (code: string) => {
    const url = inviteLink(code)
    const text = 'Присоединяйся к Life Hub — дневники, учёба, задачи. Вот приглашение:'
    if (navigator.share) {
      try { await navigator.share({ title: 'Life Hub', text, url }); return } catch { /* отмена — копируем */ }
    }
    try {
      await navigator.clipboard.writeText(`${text} ${url}`)
      setCopied(true)
    } catch { /* старый браузер: ссылка видна в поле */ }
  }

  const pending = (invites.data ?? []).filter((i) => !i.used_by)
  const used = (invites.data ?? []).filter((i) => i.used_by)

  return (
    <Card title="Пригласить родных и друзей" className="span-2">
      <p className="muted small">
        Каждая ссылка — для одного человека и действует 14 дней. По ней он создаст свой аккаунт: у каждого свои дневники,
        задачи, расписание и мозг — чужие данные никто не видит.
      </p>
      <button className="btn primary" onClick={create} disabled={busy}><Icon name="plus" size={16} /> Создать ссылку-приглашение</button>
      <ErrorNote error={error ?? invites.error} />
      {fresh && (
        <div className="invite-fresh">
          <input readOnly value={inviteLink(fresh.code)} onFocus={(e) => e.currentTarget.select()} aria-label="Ссылка-приглашение" />
          <button className="btn ghost" onClick={() => share(fresh.code)}>
            <Icon name="share" size={16} /> {copied ? 'Скопировано' : 'Отправить'}
          </button>
        </div>
      )}

      {pending.length > 0 && (
        <div className="sub-section">
          <h3>Ждут регистрации</h3>
          <ul className="invite-list">
            {pending.map((i) => (
              <li key={i.code}>
                <code>…{i.code.slice(-6)}</code>
                <span className="muted small">до {formatDate(i.expires_at, { day: 'numeric', month: 'long' })}</span>
                <div className="spacer" />
                <button className="btn ghost small" onClick={() => share(i.code)}>Отправить ещё раз</button>
                <ConfirmDelete label="Отозвать" onConfirm={() => run(() => api.invites.remove(i.code)).then(() => invites.reload())} />
              </li>
            ))}
          </ul>
        </div>
      )}
      {used.length > 0 && (
        <div className="sub-section">
          <h3>Уже присоединились</h3>
          <ul className="invite-list">
            {used.map((i) => (
              <li key={i.code}><Icon name="check" size={14} /> {i.used_by}
                <span className="muted small">· приглашение от {formatDate(i.created_at, { day: 'numeric', month: 'long' })}</span></li>
            ))}
          </ul>
        </div>
      )}
      {invites.data && invites.data.length === 0 && !fresh && <Empty>Приглашений пока нет.</Empty>}
    </Card>
  )
}

function InstallCard() {
  return (
    <Card title="Как на телефоне">
      <ul className="install-steps">
        <li><b>iPhone (Safari):</b> «Поделиться» → «На экран „Домой“».</li>
        <li><b>Android (Chrome):</b> меню ⋮ → «Добавить на главный экран» / «Установить приложение».</li>
        <li><b>Компьютер (Chrome / Edge):</b> значок установки в адресной строке.</li>
      </ul>
      <p className="muted small">Приложение откроется как обычное — без адресной строки. Вход запоминается на 90 дней.</p>
    </Card>
  )
}

function PasswordCard() {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [ok, setOk] = useState(false)
  const { run, error, busy } = useAction()
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setOk(false)
    if (await run(() => api.auth.changePassword(current, next))) {
      setCurrent(''); setNext(''); setOk(true)
    }
  }
  return (
    <Card title="Сменить пароль">
      <form className="form" onSubmit={submit}>
        <label>Текущий пароль<input type="password" required autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} /></label>
        <label>Новый пароль<input type="password" required minLength={8} autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} /></label>
        <ErrorNote error={error} />
        {ok && <div className="ok-note">Пароль изменён. На других устройствах нужно войти заново.</div>}
        <div className="form-actions"><button className="btn primary" disabled={busy}>Сохранить</button></div>
      </form>
    </Card>
  )
}
