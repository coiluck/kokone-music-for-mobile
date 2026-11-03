import { Outlet, useLocation } from 'react-router-dom'
import MiniPlayer from '../components/MiniPlayer'
import { useEffect } from 'react'
import HeaderApp from '../components/HeaderApp'
import Sidebar from '../components/Sidebar'

export default function MainLayout() {
  const location = useLocation()

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

  return (
    <>
      <HeaderApp />

      {/* 各ページのコンテンツ */}
      <main className="app-content">
        <Outlet />
        <MiniPlayer />
      </main>

      {/* サイドバーナビ */}
      <Sidebar />
    </>
  )
}
