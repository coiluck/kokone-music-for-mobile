import { Outlet, NavLink, useLocation, useNavigate } from 'react-router-dom'
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
import { ScanMessage } from './components/ScanMessage'
import { Message } from './components/Message'

export default function App() {
  const iconStyle = useSettingsStore(s => s.iconStyle)
  const loadIconSettings = useSettingsStore(s => s.loadIconSettings)
  const loadScanIgnoreSettings = useSettingsStore(s => s.loadScanIgnoreSettings)
  const loadLang = useSettingsStore(s => s.loadLang)
  const loadPlaySettings = useSettingsStore(s => s.loadPlaySettings)

  useEffect(() => {
    initDb().then(runStartupScan)
    loadAndApplyTheme()
    loadIconSettings()
    loadScanIgnoreSettings()
    loadLang()
    loadPlaySettings()
  }, [])

  const t = useMappedTranslations({
    library: 'page.library',
    playlist: 'page.playlist',
    artist: 'page.artist.top',
    album: 'page.album',
    tags: 'page.tags'
  })

  const location = useLocation()
  const navigate = useNavigate()

  useEffect(() => {
    const scrollTop = location.state?.restoreScrollTop
    if (scrollTop != null) {
      const pageEl = document.querySelector('.page')
      if (pageEl) pageEl.scrollTop = scrollTop
      // 一度復元したら消しておく
      window.history.replaceState(
        { ...window.history.state, usr: null },
        ''
      )
    }
  }, [location])

  // 検索ページへ遷移
  const handleOpenSearch = () => {
    if (location.pathname === '/search') {
      // 再度inputにfocusを合わせるため
      navigate('/search', {
        replace: true,
        state: location.state, // from / scrollTop を引き継ぐ
      })
      return
    }
    const pageEl = document.querySelector('.page')
    const scrollTop = pageEl?.scrollTop ?? 0
    navigate('/search', {
      state: { from: location.pathname, scrollTop },
    })
  }

  return (
    <div className="app-layout">
      <header className='app-header'>
        <div className='app-header-title'>
          <Icon name='icon_path' size={32} mode={null} folder='/images/' />
          <p>SymPony Music</p>
        </div>
        <div className='app-header-button-container'>
          <button
            className='app-header-button search'
            onClick={handleOpenSearch}
            aria-label="search"
          />
          <NavLink to="/settings" state={{ from: location.pathname }}>
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

      {/* スキャン中のメッセージ */}
      <ScanMessage />
      <Message />
    </div>
  )
}