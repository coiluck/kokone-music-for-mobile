// スクロール要素の外、app-layout の直下に置くこと。
interface PageHeaderProps {
  title: string
  onBack?: () => void
  actions?: React.ReactNode
}

export default function PageHeader({ title, onBack, actions }: PageHeaderProps) {
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
    </header>
  )
}
