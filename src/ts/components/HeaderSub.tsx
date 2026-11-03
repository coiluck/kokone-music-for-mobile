// スクロール要素の外、ページの最上部に置くこと。ScanMessage はヘッダーに含まれる
import { ScanMessage } from './ScanMessage'

interface HeaderSubProps {
  title: string
  onBack?: () => void
  actions?: React.ReactNode
}

export default function HeaderSub({ title, onBack, actions }: HeaderSubProps) {
  return (
    <header className="app-header">
      <div className="app-header-left">
        {onBack && (
          <button
            className="app-header-button back"
            onClick={onBack}
            aria-label="back"
          />
        )}
        <p>{title}</p>
      </div>
      {actions && <div className="app-header-button-container">{actions}</div>}
      <ScanMessage />
    </header>
  )
}
