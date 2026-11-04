import { Outlet } from 'react-router-dom'
import MiniPlayer from '../components/MiniPlayer'
import HeaderApp from '../components/HeaderApp'

export default function MainLayout() {
  return (
    <>
      <HeaderApp />

      {/* 各ページのコンテンツ */}
      <main className="app-content">
        <Outlet />
        <MiniPlayer />
      </main>
    </>
  )
}
