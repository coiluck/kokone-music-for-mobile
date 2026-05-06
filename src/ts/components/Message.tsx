import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { TransitionEvent } from 'react'
import '../../css/components/Message.css'

// ============================================================
// 外部ストア（コンポーネント外から showMessage() で呼べるように）
// ============================================================

type MessageItem = {
  id: number
  text: string
  duration: number | 'infinity'
}

let counter = 0
let items: MessageItem[] = []
const listeners = new Set<() => void>()

const subscribe = (cb: () => void) => {
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}
const getSnapshot = () => items
const emit = () => { listeners.forEach(l => l()) }

/**
 * 任意の場所から呼べるメッセージ表示関数
 * @param text 表示するメッセージ
 * @param duration ミリ秒、または 'infinity' で自動消去なし（デフォルト 3000ms）
 * @returns メッセージID（hideMessageで指定して消せる）
 */
export function showMessage(text: string, duration: number | 'infinity' = 3000): number {
  const id = ++counter
  items = [...items, { id, text, duration }]
  emit()
  return id
}

/** 指定IDのメッセージを消す（コンポーネント側でアニメーション付きで除去される） */
export function hideMessage(id: number) {
  items = items.filter(m => m.id !== id)
  emit()
}

/** すべてのメッセージを消す */
export function clearMessages() {
  items = []
  emit()
}

// ============================================================
// 1メッセージ分のサブコンポーネント
// ============================================================

function MessageItemView({ item, onClose }: { item: MessageItem; onClose: () => void }) {
  const [visible, setVisible] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [fillWidth, setFillWidth] = useState('100%')
  const removeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fillTimer   = useRef<ReturnType<typeof setTimeout> | null>(null)

  // マウント直後にis-visibleを付ける（slide-inアニメーション用）
  useEffect(() => {
    const id = requestAnimationFrame(() => setVisible(true))
    return () => cancelAnimationFrame(id)
  }, [])

  // 自動消去のスケジューリング
  useEffect(() => {
    if (item.duration === 'infinity' || typeof item.duration !== 'number') return

    removeTimer.current = setTimeout(() => {
      startRemoving()
    }, item.duration)

    // 進捗バーを 100% → 0% へ
    fillTimer.current = setTimeout(() => {
      setFillWidth('0%')
    }, 100)

    return () => {
      if (removeTimer.current) clearTimeout(removeTimer.current)
      if (fillTimer.current) clearTimeout(fillTimer.current)
    }
    // item.id が変わらない限り再スケジュールしない
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id])

  const startRemoving = () => {
    if (removing) return
    setRemoving(true)
  }

  const handleTransitionEnd = (e: TransitionEvent<HTMLDivElement>) => {
    // is-removing による transform/opacity の遷移完了時のみ取り除く
    if (!removing) return
    if (e.propertyName !== 'opacity' && e.propertyName !== 'transform') return
    onClose()
  }

  const handleClick = () => {
    if (removeTimer.current) clearTimeout(removeTimer.current)
    if (fillTimer.current) clearTimeout(fillTimer.current)
    startRemoving()
  }

  const className = [
    'msg-component-message',
    visible ? 'is-visible' : '',
    removing ? 'is-removing' : '',
  ].filter(Boolean).join(' ')

  const showProgress = item.duration !== 'infinity' && typeof item.duration === 'number'
  const durationSec = showProgress ? (item.duration as number) / 1000 : 0

  return (
    <div className={className} onClick={handleClick} onTransitionEnd={handleTransitionEnd}>
      <div className="msg-component-content">{item.text}</div>
      {showProgress && (
        <div className="msg-component-progress">
          <div
            className="msg-component-fill"
            style={{
              width: fillWidth,
              transition: `width ${durationSec}s linear`,
            }}
          />
        </div>
      )}
    </div>
  )
}

// ============================================================
// メインコンポーネント（アプリのどこかに1つだけマウントする）
// ============================================================

export function Message() {
  const list = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  // ストアからは消えたが、is-removingアニメーション中は表示し続けたいので
  // 描画用のローカル配列を別に持つ
  const [rendered, setRendered] = useState<MessageItem[]>([])
  const [closingIds, setClosingIds] = useState<Set<number>>(new Set())

  useEffect(() => {
    setRendered(prev => {
      const prevIds = new Set(prev.map(p => p.id))
      const nowIds  = new Set(list.map(p => p.id))

      // 新規追加分を末尾に追加
      const added = list.filter(m => !prevIds.has(m.id))

      // ストアから消えたものを is-removing 対象としてマーク（描画は残す）
      const newlyClosing = prev.filter(m => !nowIds.has(m.id)).map(m => m.id)
      if (newlyClosing.length > 0) {
        setClosingIds(s => {
          const next = new Set(s)
          newlyClosing.forEach(id => next.add(id))
          return next
        })
      }

      return [...prev, ...added]
    })
  }, [list])

  const handleClose = (id: number) => {
    setRendered(prev => prev.filter(m => m.id !== id))
    setClosingIds(s => {
      if (!s.has(id)) return s
      const next = new Set(s)
      next.delete(id)
      return next
    })
    // ストア側にまだ残っていたら（ユーザクリックなどで先に閉じた場合）取り除く
    if (items.some(m => m.id === id)) {
      items = items.filter(m => m.id !== id)
      emit()
    }
  }

  return (
    <div className="msg-component-box">
      {rendered.map(item => (
        <MessageItemView
          key={item.id}
          item={item}
          onClose={() => handleClose(item.id)}
        />
      ))}
    </div>
  )
}