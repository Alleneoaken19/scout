import { Routes, Route, NavLink, Navigate, useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { LayoutDashboard, Briefcase, FileText, BarChart3, Settings, Clock, Radar, Key, Loader2, Database } from 'lucide-react'
import Dashboard from './pages/Dashboard'
import Jobs from './pages/Jobs'
import Sources from './pages/Sources'
import ResumeStudio from './pages/ResumeStudio'
import Analytics from './pages/Analytics'
import Preferences from './pages/Preferences'
import Scheduler from './pages/Scheduler'
import SettingsPage from './pages/Settings'
import JobDetail from './pages/JobDetail'
import SetupWizard from './pages/SetupWizard'
import { fetchSetupStatus } from './api'

const NAV = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/jobs', icon: Briefcase, label: 'Jobs' },
  { to: '/sources', icon: Database, label: 'Sources' },
  { to: '/resume', icon: FileText, label: 'Resume Studio' },
  { to: '/analytics', icon: BarChart3, label: 'Analytics' },
  { to: '/preferences', icon: Settings, label: 'Preferences' },
  { to: '/scheduler', icon: Clock, label: 'Scheduler' },
  { to: '/settings', icon: Key, label: 'Settings' },
]

export default function App() {
  const location = useLocation()

  const { data: setupStatus, isLoading: setupLoading } = useQuery({
    queryKey: ['setup-status'],
    queryFn: fetchSetupStatus,
  })

  // Show a centered spinner while checking setup status
  if (setupLoading) {
    return (
      <div
        className="flex items-center justify-center h-screen"
        style={{ background: 'var(--bg-primary)' }}
      >
        <Loader2 className="w-8 h-8 animate-spin" style={{ color: 'var(--accent)' }} />
      </div>
    )
  }

  // Redirect to setup if not complete and not dismissed
  const setupDismissed = localStorage.getItem('scout_setup_dismissed')
  const needsSetup = !setupStatus?.is_complete && !setupDismissed
  const isOnSetup = location.pathname === '/setup'

  if (needsSetup && !isOnSetup) {
    return (
      <Routes>
        <Route path="*" element={<Navigate to="/setup" replace />} />
        <Route path="/setup" element={<SetupWizard />} />
      </Routes>
    )
  }

  // Setup wizard as a full-screen route (no sidebar)
  if (isOnSetup) {
    return (
      <Routes>
        <Route path="/setup" element={<SetupWizard />} />
      </Routes>
    )
  }

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: 'var(--bg-primary)' }}>
      {/* Sidebar */}
      <aside className="w-64 flex-shrink-0 flex flex-col border-r" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)' }}>
        <div className="p-5 flex items-center gap-3">
          <Radar className="w-7 h-7" style={{ color: 'var(--accent)' }} />
          <span className="text-xl font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>Scout</span>
        </div>
        <nav className="flex-1 px-3 space-y-1">
          {NAV.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                  isActive ? 'text-white' : ''
                }`
              }
              style={({ isActive }) => ({
                background: isActive ? 'var(--accent)' : 'transparent',
                color: isActive ? '#fff' : 'var(--text-secondary)',
              })}
            >
              <Icon className="w-4.5 h-4.5" />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="p-4 text-xs" style={{ color: 'var(--text-secondary)' }}>
          Scout v0.1.0 — localhost
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto p-6">
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/jobs" element={<Jobs />} />
          <Route path="/jobs/:id" element={<JobDetail />} />
          <Route path="/sources" element={<Sources />} />
          <Route path="/resume" element={<ResumeStudio />} />
          <Route path="/analytics" element={<Analytics />} />
          <Route path="/preferences" element={<Preferences />} />
          <Route path="/scheduler" element={<Scheduler />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </main>
    </div>
  )
}
