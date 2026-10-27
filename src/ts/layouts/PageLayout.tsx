import { Outlet } from 'react-router-dom'
import '../../css/default.css'
import '../../css/app.css'
import { ScanMessage } from '../components/ScanMessage'

export default function PageLayout() {
  return (
    <div className="app-layout">
      <Outlet />
      <ScanMessage />
    </div>
  )
}
