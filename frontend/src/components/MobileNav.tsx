import { useState } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from './auth'
import { QuickAdd } from './QuickAdd'
import { Icon, Modal } from './ui'

const MORE = [
  { to: '/food', label: 'Питание', icon: 'food' },
  { to: '/workouts', label: 'Тренировки', icon: 'dumbbell' },
  { to: '/brain', label: 'Мозг', icon: 'brain' },
  { to: '/profile', label: 'Профиль', icon: 'user' },
]

// Нижняя панель на телефоне: 4 раздела + большая кнопка «Добавить» по центру.
export function MobileNav() {
  const [adding, setAdding] = useState(false)
  const [more, setMore] = useState(false)
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const { user } = useAuth()
  const moreActive = MORE.some((m) => pathname.startsWith(m.to))

  return (
    <>
      <nav className="mobile-nav" aria-label="Разделы">
        <NavLink to="/" end className="mnav-link"><Icon name="home" size={22} /><span>Сегодня</span></NavLink>
        <NavLink to="/calendar" className="mnav-link"><Icon name="calendar" size={22} /><span>Календарь</span></NavLink>
        <button className="mnav-fab" onClick={() => setAdding(true)} aria-label="Добавить запись">
          <Icon name="plus" size={26} />
        </button>
        <NavLink to="/study" className="mnav-link"><Icon name="book" size={22} /><span>Учёба</span></NavLink>
        <button className={`mnav-link ${moreActive ? 'active' : ''}`} onClick={() => setMore(true)}>
          <Icon name="more" size={22} /><span>Ещё</span>
        </button>
      </nav>

      {adding && <QuickAdd onClose={() => setAdding(false)} />}
      {more && (
        <Modal title="Разделы" onClose={() => setMore(false)}>
          <div className="more-grid">
            {MORE.map((m) => (
              <button key={m.to} className={`more-item ${pathname.startsWith(m.to) ? 'active' : ''}`}
                onClick={() => { setMore(false); navigate(m.to) }}>
                {m.to === '/profile'
                  ? <span className="avatar">{user.name.slice(0, 1).toUpperCase()}</span>
                  : <span className="more-icon"><Icon name={m.icon} size={22} /></span>}
                <span>{m.to === '/profile' ? user.name : m.label}</span>
              </button>
            ))}
          </div>
        </Modal>
      )}
    </>
  )
}
