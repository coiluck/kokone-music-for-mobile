import { NavLink } from 'react-router-dom'
import { Icon } from './Icon'
import { ScanMessage } from './ScanMessage'
import { useSettingsStore } from '../lib/settingsStore'
import { useOpenSearch } from '../lib/useOpenSearch'

// MainLayout のヘッダー。ScanMessage はヘッダーの下端に重ねて出す
// PC では ScanMessage だけを残して隠す (ロゴと検索・設定は Sidebar に出す)
export default function HeaderApp() {
  const handleOpenSearch = useOpenSearch()

  const iconStyle = useSettingsStore(s => s.iconStyle)

  return (
    <header className='app-header app-header-main'>
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
        <NavLink to="/settings">
          <Icon name="settings" size={24} mode={iconStyle} folder='/images/App/' className='app-header-button' />
        </NavLink>
      </div>
      <ScanMessage />
    </header>
  )
}
