import { Link, NavLink, useLocation } from 'react-router-dom'
import { Icon } from './Icon'
import { useSettingsStore } from '../lib/settingsStore'
import { useMappedTranslations } from '../lib/i18n'
import { useOpenSearch } from '../lib/useOpenSearch'
import '../../css/components/Sidebar.css'

export default function Sidebar() {
  const location = useLocation()
  const handleOpenSearch = useOpenSearch()

  const iconStyle = useSettingsStore(s => s.iconStyle)

  const t = useMappedTranslations({
    library: 'page.library',
    playlist: 'page.playlist',
    artist: 'page.artist.top',
    album: 'page.album',
    tags: 'page.tags',
    search: 'page.search',
    settings: 'page.settings'
  })

  return (
    <nav className="app-sidebar">
      {/* PC のみ */}
      <div className="app-sidebar-brand">
        <Icon name='icon_path' size={32} mode={null} folder='/images/' />
        <p>SymPony Music</p>
      </div>
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
      <NavLink to="/tags" className={({ isActive }) => isActive ? 'nav-active' : ''}>
        <div className="app-sidebar-item">
          <Icon name="tags" mode={iconStyle} folder='/images/App/' className='app-sidebar-item-icon' />
          <span className="app-sidebar-item-label">{t.tags}</span>
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
      {/* PC のみ。スマホは HeaderApp に出す */}
      <div className="app-sidebar-actions">
        <button
          className={location.pathname === '/sub/search' ? 'nav-active' : ''}
          onClick={handleOpenSearch}
        >
          <div className="app-sidebar-item">
            <Icon name="search" mode={null} folder='/images/App/' className='app-sidebar-item-icon' />
            <span className="app-sidebar-item-label">{t.search}</span>
          </div>
        </button>
        <Link
          to="/settings"
          className={['/settings', '/stats'].includes(location.pathname) ? 'nav-active' : ''}
        >
          <div className="app-sidebar-item">
            <Icon name="settings" mode={iconStyle} folder='/images/App/' className='app-sidebar-item-icon' />
            <span className="app-sidebar-item-label">{t.settings}</span>
          </div>
        </Link>
      </div>
    </nav>
  )
}
