import SettingsPage from './../pages/SettingsPage'
import { useNavigate, useLocation } from 'react-router-dom'
import { useMappedTranslations } from './../lib/i18n'

export default function SettingsLayout() {
  const navigate = useNavigate()
  const location = useLocation()
  const from = location.state?.from ?? '/'

  const t = useMappedTranslations({
    title: 'settings.title',
  })

  return (
    <div className="app-layout">
      <header className="app-header" style={{ justifyContent: 'flex-start', gap: '1rem' }}>
        <button className='app-header-button back' onClick={() => navigate(from)}>
        </button>
        <p>{t.title}</p>
      </header>

      <main className="app-content">
        <SettingsPage />
      </main>
    </div>
  )
}