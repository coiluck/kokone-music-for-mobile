import { Outlet, NavLink } from 'react-router-dom'
import MiniPlayer from './components/MiniPlayer'
import { useEffect } from 'react'
import { runStartupScan } from './lib/scanFolders'

export default function App() {

  // アプリ起動時に自動スキャン実行
  useEffect(() => {
    runStartupScan()
  }, [])

  return (
    <div className="app-layout">
      {/* サイドバーナビ */}
      <nav className="sidebar">
        <NavLink to="/">ライブラリ</NavLink>
        <NavLink to="/playlists">プレイリスト</NavLink>
        <NavLink to="/settings">設定</NavLink>
      </nav>

      {/* 各ページのコンテンツ */}
      <main className="content">
        <Outlet />
        <MiniPlayer />
      </main>
    </div>
  )
}