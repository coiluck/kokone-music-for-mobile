import { Outlet } from 'react-router-dom'
import '../../css/default.css'
import '../../css/app.css'
import { Message } from '../components/Message'

// 全ページ共通
export default function RootLayout() {
  return (
    <div className="app-layout">
      <Outlet />
      <Message />
    </div>
  )
}
