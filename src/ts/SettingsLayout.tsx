import SettingsPage from './pages/SettingsPage'
import MiniPlayer from './components/MiniPlayer'
import { NavLink } from 'react-router-dom'

export default function SettingsLayout() {
  return (
    <div className="app-layout">
      <header className="app-header">
        <p>Music</p>
        <NavLink to="/">← 戻る</NavLink>
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