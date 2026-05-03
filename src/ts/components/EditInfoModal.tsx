import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from "./Icon"
import '../../css/components/EditInfoModal.css'

interface Props {
  title: string
  onClose: () => void
  children?: React.ReactNode
}

export default function EditInfoModal({ title, onClose, children }: Props) {
  // Esc で閉じる
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  // 背後のスクロールを止める
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])

  return createPortal(
    <div className="ei-component-backdrop" onClick={onClose}>
      <div
        className="ei-component-container"
        onClick={e => e.stopPropagation()}
      >
        <div className="ei-component-header">
          <span className="ei-component-title">{title}</span>
          <div
            className="ei-component-close-container"
            onClick={onClose}
          >
            <Icon name="xmark" mode={null} size={16} folder="/images/EditInfoModal/" />
          </div>
        </div>
        <div className="ei-component-body">
          {children}
        </div>
      </div>
    </div>,
    document.body
  )
}