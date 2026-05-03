import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import '../../css/components/ItemActionsMenu.css'

export interface ActionMenuItem {
  key: string
  label: string
  onClick: () => void
  /** 区切り線の上に置く（破壊的アクション等を視覚的に分離する用途） */
  separatorBefore?: boolean
  danger?: boolean
}

interface Props {
  /** メニューの基準となるボタン要素 */
  anchorEl: HTMLElement | null
  items: ActionMenuItem[]
  onClose: () => void
}

const MARGIN = 4 // ボタンとメニューの間の余白

export default function ItemActionsMenu({ anchorEl, items, onClose }: Props) {
  const menuRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; right: number; placement: 'down' | 'up' } | null>(null)

  // 位置計算（描画前に決めるため useLayoutEffect）
  useLayoutEffect(() => {
    if (!anchorEl) return

    const calc = () => {
      if (!anchorEl || !menuRef.current) return
      const btnRect = anchorEl.getBoundingClientRect()
      const menuRect = menuRef.current.getBoundingClientRect()

      const vh = window.innerHeight
      const spaceBelow = vh - btnRect.bottom
      // メニューの高さが下に収まらないなら上側に出す
      const placement: 'down' | 'up' =
        spaceBelow >= menuRect.height + MARGIN || btnRect.top < menuRect.height + MARGIN
          ? 'down'
          : 'up'

      // 右をボタンの右に合わせる
      const right = window.innerWidth - btnRect.right
      const top =
        placement === 'down'
          ? btnRect.bottom + MARGIN
          : btnRect.top - menuRect.height - MARGIN

      setPos({ top, right, placement })
    }

    calc()

    window.addEventListener('resize', calc)
    window.addEventListener('scroll', calc, true)
    return () => {
      window.removeEventListener('resize', calc)
      window.removeEventListener('scroll', calc, true)
    }
  }, [anchorEl])

  // 外側クリック / Escキーで閉じる
  useEffect(() => {
    const handlePointerDown = (e: PointerEvent) => {
      const target = e.target as Node
      if (menuRef.current?.contains(target)) return
      if (anchorEl?.contains(target)) return
      onClose()
    }
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKey)
    }
  }, [anchorEl, onClose])

  return createPortal(
    <div
      ref={menuRef}
      className="am-component-container"
      style={{
        top: pos?.top ?? -9999,
        right: pos?.right ?? 0,
        // 初回計算が終わるまで非表示
        visibility: pos ? 'visible' : 'hidden',
      }}
      role="menu"
    >
      {items.map((item, i) => (
        <div key={item.key}>
          {item.separatorBefore && i !== 0 && <div className="am-component-separator" />}
          <button
            className={`am-component-item${item.danger ? ' is-danger' : ''}`}
            onClick={e => {
              e.stopPropagation()
              item.onClick()
              onClose()
            }}
          >
            {item.label}
          </button>
        </div>
      ))}
    </div>,
    document.body
  )
}