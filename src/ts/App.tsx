import { Outlet, NavLink } from 'react-router-dom'
import MiniPlayer from './components/MiniPlayer'
import { useEffect } from 'react'
import { runStartupScan } from './lib/scanFolders'
import { useMappedTranslations } from './lib/i18n'

export default function App() {
  useEffect(() => {
    runStartupScan()
  }, [])

  const t = useMappedTranslations({
    library: 'page.library',
    playlist: 'page.playlist',
    artist: 'page.artist.top',
    album: 'page.album'
  })

  return (
    <div className="app-layout">
      <header className='app-header'>
        <p>Music</p>
        <NavLink to="/settings">設定</NavLink>
      </header>
      
      {/* サイドバーナビ */}
      <nav className="app-sidebar">
        <NavLink to="/">{t.library}</NavLink>
        <NavLink to="/playlists">{t.playlist}</NavLink>
        <NavLink to="/srtist">{t.artist}</NavLink>
        <NavLink to="/album">{t.album}</NavLink>
      </nav>

      {/* 各ページのコンテンツ */}
      <main className="app-content">
        <Outlet />
        <MiniPlayer />
      </main>
    </div>
  )
}