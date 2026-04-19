import SettingsPage from './pages/SettingsPage'
import MiniPlayer from './components/MiniPlayer'
import { useNavigate } from 'react-router-dom'
import { useMappedTranslations } from './lib/i18n'

export default function SettingsLayout() {
  const navigate = useNavigate()

  const t = useMappedTranslations({
    title: 'settings.title',
  })

  return (
    <div className="app-layout">
      <header className="app-header" style={{ justifyContent: 'flex-start', gap: '1rem' }}>
        <button className='app-header-button back' onClick={() => navigate(-1)}>
        </button>
        <p>{t.title}</p>
      </header>

      <main className="app-content">
        <SettingsPage />
      </main>

      {/* 再生は継続させるが見せない */}
      <div style={{ display: 'none' }}>
        <MiniPlayer />
      </div>
    </div>
  )
}