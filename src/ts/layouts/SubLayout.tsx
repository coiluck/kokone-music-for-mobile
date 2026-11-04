// layouts/SubLayout.tsx
import { Outlet } from 'react-router-dom'
import MiniPlayer from './../components/MiniPlayer'

// ヘッダーは各ページが HeaderSub で描く (SearchPage はヘッダー無し)
export default function SubLayout() {
  return (
    <>
      <main className="app-content">
        <Outlet />
        <MiniPlayer />
      </main>
    </>
  )
}
