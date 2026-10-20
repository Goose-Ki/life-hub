import { createContext, FormEvent, ReactNode, useCallback, useContext, useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { api, UNAUTHORIZED_EVENT, User } from '../api'
import { ErrorNote, Icon, useAction } from './ui'

type AuthState =
  | { kind: 'loading' }
  | { kind: 'anon'; hasUsers: boolean }
  | { kind: 'user'; user: User }

interface AuthCtx {
  user: User
  logout: () => Promise<void>
}

const Ctx = createContext<AuthCtx | null>(null)

// Текущий пользователь — доступен во всём приложении после входа.
export function useAuth() {
  const c = useContext(Ctx)
  if (!c) throw new Error('useAuth outside AuthProvider')
  return c
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ kind: 'loading' })

  const refresh = useCallback(async () => {
    try {
      setState({ kind: 'user', user: await api.auth.me() })
    } catch {
      try {
        const st = await api.auth.status()
        setState({ kind: 'anon', hasUsers: st.has_users })
      } catch {
        setState({ kind: 'anon', hasUsers: true })
      }
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])
  useEffect(() => {
    const onUnauth = () => setState((s) => (s.kind === 'user' ? { kind: 'anon', hasUsers: true } : s))
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauth)
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauth)
  }, [])

  const logout = useCallback(async () => {
    await api.auth.logout().catch(() => undefined)
    setState({ kind: 'anon', hasUsers: true })
  }, [])

  if (state.kind === 'loading') {
    return <div className="auth-splash"><span className="brand-logo big"><Icon name="check" size={28} /></span></div>
  }
  if (state.kind === 'anon') {
    return <AuthScreen hasUsers={state.hasUsers} onAuthed={(user) => setState({ kind: 'user', user })} />
  }
  return <Ctx.Provider value={{ user: state.user, logout }}>{children}</Ctx.Provider>
}

// ---------- Экран входа / регистрации ----------

function AuthScreen({ hasUsers, onAuthed }: { hasUsers: boolean; onAuthed: (u: User) => void }) {
  const location = useLocation()
  const navigate = useNavigate()
  const inviteFromUrl = location.pathname.match(/^\/join\/([^/]+)/)?.[1] ?? ''
  const [mode, setMode] = useState<'login' | 'register'>(inviteFromUrl || !hasUsers ? 'register' : 'login')
  const [inviteFrom, setInviteFrom] = useState<string | null>(null)
  const [inviteBad, setInviteBad] = useState(false)

  useEffect(() => {
    if (!inviteFromUrl) return
    api.invites.check(inviteFromUrl)
      .then((r) => setInviteFrom(r.from))
      .catch(() => setInviteBad(true))
  }, [inviteFromUrl])

  const done = (u: User) => {
    if (inviteFromUrl) navigate('/', { replace: true })
    onAuthed(u)
  }

  const first = !hasUsers
  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-brand">
          <span className="brand-logo big"><Icon name="check" size={24} /></span>
          <div>
            <div className="auth-title">Life Hub</div>
            <div className="muted small">Дневники, учёба, задачи и твой мозг</div>
          </div>
        </div>

        {mode === 'register' && first && (
          <p className="auth-note">Это первый вход: создай аккаунт администратора. Все уже внесённые данные станут твоими,
            а родных и друзей потом можно пригласить по ссылке.</p>
        )}
        {mode === 'register' && inviteFrom && <p className="auth-note">{inviteFrom} приглашает тебя в Life Hub. У тебя будут свои отдельные дневники.</p>}
        {mode === 'register' && inviteBad && <div className="error-note">Ссылка-приглашение недействительна или истекла. Попроси новую.</div>}

        {mode === 'login'
          ? <LoginForm onDone={done} />
          : <RegisterForm invite={inviteFromUrl} first={first} disabled={inviteBad} onDone={done} />}

        {hasUsers && (
          <div className="auth-switch">
            {mode === 'login'
              ? <span className="muted small">Нет аккаунта? Регистрация — по ссылке-приглашению.</span>
              : <button className="link-btn" onClick={() => setMode('login')}>У меня уже есть аккаунт — войти</button>}
          </div>
        )}
      </div>
    </div>
  )
}

function LoginForm({ onDone }: { onDone: (u: User) => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const { run, error, busy } = useAction()
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    let u: User | null = null
    if (await run(async () => { u = await api.auth.login(username, password) }) && u) onDone(u)
  }
  return (
    <form className="form" onSubmit={submit}>
      <label>Логин<input autoFocus required autoComplete="username" autoCapitalize="none" value={username} onChange={(e) => setUsername(e.target.value)} /></label>
      <label>Пароль<input required type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
      <ErrorNote error={error} />
      <button className="btn primary wide" disabled={busy}>{busy ? 'Входим…' : 'Войти'}</button>
    </form>
  )
}

function RegisterForm({ invite, first, disabled, onDone }: { invite: string; first: boolean; disabled: boolean; onDone: (u: User) => void }) {
  const [name, setName] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [password2, setPassword2] = useState('')
  const { run, error, busy, setError } = useAction()
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (password !== password2) { setError('Пароли не совпадают'); return }
    let u: User | null = null
    if (await run(async () => { u = await api.auth.register({ invite: invite || undefined, name, username, password }) }) && u) onDone(u)
  }
  return (
    <form className="form" onSubmit={submit}>
      <label>Как тебя зовут<input autoFocus required maxLength={50} value={name} onChange={(e) => setName(e.target.value)} placeholder="Дима" /></label>
      <label>Логин
        <input required autoComplete="username" autoCapitalize="none" pattern="[A-Za-z0-9_.\-]{3,32}" value={username}
          onChange={(e) => setUsername(e.target.value)} placeholder="dima" />
        <span className="hint">латиница, цифры, _ . - (3–32 символа)</span>
      </label>
      <div className="row">
        <label>Пароль<input required type="password" minLength={8} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        <label>Ещё раз<input required type="password" minLength={8} autoComplete="new-password" value={password2} onChange={(e) => setPassword2(e.target.value)} /></label>
      </div>
      <ErrorNote error={error} />
      <button className="btn primary wide" disabled={busy || disabled || (!first && !invite)}>
        {busy ? 'Создаём…' : 'Создать аккаунт'}
      </button>
    </form>
  )
}
