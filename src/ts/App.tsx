import { Outlet, NavLink } from 'react-router-dom'
import MiniPlayer from './components/MiniPlayer'
import { useEffect } from 'react'
import { runStartupScan } from './lib/scanFolders'
import { initDb } from './lib/db'
import { useMappedTranslations } from './lib/i18n'
import '../css/default.css'
import '../css/app.css'
import { loadAndApplyTheme } from './lib/theme'
import { Icon } from './components/Icon'
import { useSettingsStore } from './lib/settingsStore'

export default function App() {
  const iconStyle = useSettingsStore(s => s.iconStyle)
  const loadIconSettings = useSettingsStore(s => s.loadIconSettings)
  const loadScanIgnoreSettings = useSettingsStore(s => s.loadScanIgnoreSettings)
  const loadLang = useSettingsStore(s => s.loadLang)

  useEffect(() => {
    initDb().then(runStartupScan)
    loadAndApplyTheme()
    loadIconSettings()
    loadScanIgnoreSettings()
    loadLang()
  }, [])

  const t = useMappedTranslations({
    library: 'page.library',
    playlist: 'page.playlist',
    artist: 'page.artist.top',
    album: 'page.album',
    tags: 'page.tags'
  })

  return (
    <div className="app-layout">
      <header className='app-header'>
        <p>Kokone Music</p>
        <div className='app-header-button-container'>
          <div className='app-header-button search' />
          <NavLink to="/settings">
            <Icon name="settings" size={24} mode={iconStyle} folder='/images/App/' className='app-header-button' />
          </NavLink>
        </div>
      </header>

      {/* 各ページのコンテンツ */}
      <main className="app-content">
        <Outlet />
        <MiniPlayer />
      </main>

      {/* サイドバーナビ */}
      <nav className="app-sidebar">
        <NavLink to="/" className={({ isActive }) => isActive ? 'nav-active' : ''}>
          <div className="app-sidebar-item">
            <Icon name="library" mode={iconStyle} folder='/images/App/' className='app-sidebar-item-icon' />
            <span className="app-sidebar-item-label">{t.library}</span>
          </div>
        </NavLink>
        <NavLink to="/playlists" className={({ isActive }) => isActive ? 'nav-active' : ''}>
          <div className="app-sidebar-item">
            <Icon name="playlist" mode={iconStyle} folder='/images/App/' className='app-sidebar-item-icon' />
            <span className="app-sidebar-item-label">{t.playlist}</span>
          </div>
        </NavLink>
        <NavLink to="/artist" className={({ isActive }) => isActive ? 'nav-active' : ''}>
          <div className="app-sidebar-item">
            <Icon name="artist" mode={iconStyle} folder='/images/App/' className='app-sidebar-item-icon' />
            <span className="app-sidebar-item-label">{t.artist}</span>
          </div>
        </NavLink>
        <NavLink to="/album" className={({ isActive }) => isActive ? 'nav-active' : ''}>
          <div className="app-sidebar-item">
            <Icon name="album" mode={iconStyle} folder='/images/App/' className='app-sidebar-item-icon' />
            <span className="app-sidebar-item-label">{t.album}</span>
          </div>
        </NavLink>
        <NavLink to="/tags" className={({ isActive }) => isActive ? 'nav-active' : ''}>
          <div className="app-sidebar-item">
            <Icon name="tags" mode={iconStyle} folder='/images/App/' className='app-sidebar-item-icon' />
            <span className="app-sidebar-item-label">{t.tags}</span>
          </div>
        </NavLink>
      </nav>
    </div>
  )
}