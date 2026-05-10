// layouts/SubLayout.tsx
import { Outlet } from 'react-router-dom'
import '../../css/default.css'
import '../../css/app.css'
import { NavLink } from 'react-router-dom'
import { Icon } from './../components/Icon'
import { useSettingsStore } from './../lib/settingsStore'
import { useMappedTranslations } from './../lib/i18n'
import MiniPlayer from './../components/MiniPlayer'

export default function SubLayout() {
  const iconStyle = useSettingsStore(s => s.iconStyle)

  const t = useMappedTranslations({
    library: 'page.library',
    playlist: 'page.playlist',
    artist: 'page.artist.top',
    album: 'page.album',
    tags: 'page.tags'
  })

  return (
    <div className="app-layout">
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