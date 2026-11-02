import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { Icon } from './Icon'
import { ScanMessage } from './ScanMessage'
import { useSettingsStore } from '../lib/settingsStore'

// MainLayout のヘッダー。ScanMessage はヘッダーの下端に重ねて出す
export default function HeaderApp() {
  const location = useLocation()
  const navigate = useNavigate()

  const iconStyle = useSettingsStore(s => s.iconStyle)

  // 検索ページへ遷移
  const handleOpenSearch = () => {
    if (location.pathname === '/sub/search') {
      // 再度inputにfocusを合わせるため
      navigate('/sub/search', {
        replace: true,
        state: location.state, // from / scrollTop を引き継ぐ
      })
      return
    }
    const pageEl = document.querySelector('.page')
    const scrollTop = pageEl?.scrollTop ?? 0
    navigate('/sub/search', {
      state: { from: location.pathname, scrollTop },
    })
  }

  return (
    <header className='app-header'>
      <div className='app-header-title'>
        <Icon name='icon_path' size={32} mode={null} folder='/images/' />
        <p>SymPony Music</p>
      </div>
      <div className='app-header-button-container'>
        <button
          className='app-header-button search'
          onClick={handleOpenSearch}
          aria-label="search"
        />
        <NavLink to="/settings" state={{ from: location.pathname }}>
          <Icon name="settings" size={24} mode={iconStyle} folder='/images/App/' className='app-header-button' />
        </NavLink>
      </div>
      <ScanMessage />
    </header>
  )
}
