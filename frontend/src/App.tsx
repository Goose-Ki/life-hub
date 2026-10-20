import { Link, NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './components/auth'
import { Icon } from './components/ui'
import BrainPage from './components/brain/BrainView'
import CalendarPage from './pages/Calendar'
import FoodPage from './pages/Food'
import ProfilePage from './pages/Profile'
import StudyPage from './pages/Study'
import TodayPage from './pages/Today'
import WorkoutsPage from './pages/Workouts'

const NAV = [
  { to: '/', label: 'Сегодня', icon: 'home' },
  { to: '/calendar', label: 'Календарь', icon: 'calendar' },
  { to: '/study', label: 'Учёба', icon: 'book' },
  { to: '/brain', label: 'Мозг', icon: 'brain' },
  { to: '/food', label: 'Питание', icon: 'food' },
  { to: '/workouts', label: 'Тренировки', icon: 'dumbbell' },
]

export default function App() {
  return (
    <AuthProvider>
      <Shell />
    </AuthProvider>
  )
}

function Shell() {
  const { user } = useAuth()
  return (
    <div className="app">
      <nav className="sidebar" aria-label="Разделы">
        <div className="brand">
          <span className="brand-logo"><Icon name="check" size={16} /></span>
          Life Hub
        </div>
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.to === '/'} className="nav-link">
            <Icon name={n.icon} size={20} />
            <span>{n.label}</span>
          </NavLink>
        ))}
        <NavLink to="/profile" className="nav-link user-link" title="Профиль">
          <span className="avatar">{user.name.slice(0, 1).toUpperCase()}</span>
          <span className="user-name">{user.name}</span>
        </NavLink>
      </nav>
      <Link to="/profile" className="mobile-avatar avatar" aria-label="Профиль">{user.name.slice(0, 1).toUpperCase()}</Link>
      <main className="content">
        <Routes>
          <Route path="/" element={<TodayPage />} />
          <Route path="/calendar" element={<CalendarPage />} />
          <Route path="/study" element={<StudyPage />} />
          <Route path="/brain" element={<BrainPage />} />
          <Route path="/food" element={<FoodPage />} />
          <Route path="/workouts" element={<WorkoutsPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  )
}
