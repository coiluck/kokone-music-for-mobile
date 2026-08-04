import { Outlet } from 'react-router-dom'
import '../../css/default.css'
import '../../css/app.css'

export default function PageLayout() {
  return (
    <div className="app-layout">
      <Outlet />
    </div>
  )
}
