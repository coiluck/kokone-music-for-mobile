import SettingsPage from './pages/SettingsPage'
import MiniPlayer from './components/MiniPlayer'
import { useNavigate } from 'react-router-dom'

export default function SettingsLayout() {
  const navigate = useNavigate()

  return (
    <div className="app-layout">
      <header className="app-header" style={{ justifyContent: 'flex-start', gap: '1rem' }}>
        <button className='app-header-button back' onClick={() => navigate(-1)}>
        </button>
        <p>Settings</p>
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