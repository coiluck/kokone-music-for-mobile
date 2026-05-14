import { useState, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useMappedTranslations } from '../../lib/i18n'
import { usePlayerStore } from '../../lib/playerStore'
import { musicPlayer } from '../../lib/music'
import MusicItem from '../../components/MusicItem'
import type { Track } from '../../lib/db'
import { Icon } from '../../components/Icon'
import {
  DndContext,
  PointerSensor,
  TouchSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import ItemActionsMenu, { type ActionMenuItem } from "../../components/ItemActionsMenu"
import '../../../css/pages/sub/QueuePage.css'

export default function QueuePage() {
  const navigate = useNavigate()
  const location = useLocation()
  const actionsBtnRef = useRef<HTMLDivElement>(null)
  const [menuOpen, setMenuOpen] = useState(false)

  // App.tsx 側で MiniPlayer の List ボタンが渡してくれる
  const from = (location.state?.from as string | undefined) ?? '/'
  const scrollTop = (location.state?.scrollTop as number | undefined) ?? 0

  const queue = usePlayerStore(s => s.queue)

  const t = useMappedTranslations({
    title: 'queue.title',
    shuffle: 'queue.item.shuffle',
    allClear: 'queue.item.all-clear',
  })

  const handleShuffle = () => {
    const current = [...musicPlayer.getQueue()]
    for (let i = current.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[current[i], current[j]] = [current[j], current[i]]
    }
    musicPlayer.setQueue(current)
  }

  const handleClearDuplicates = () => {
    const current = musicPlayer.getQueue()
    const seen = new Set<number>()
    const next: Track[] = []
    for (const track of current) {
      if (seen.has(track.id)) continue
      seen.add(track.id)
      next.push(track)
    }
    musicPlayer.setQueue(next)
  }

  const handleClearAll = () => {
    musicPlayer.clearQueue()
  }

  const menuItems: ActionMenuItem[] = [
    {
      key: 'shuffle',
      label: t.shuffle,
      onClick: () => handleShuffle(),
    },
    {
      key: 'all-clear',
      label: t.allClear,
      separatorBefore: true,
      onClick: () => handleClearAll(),
    },
  ]

  const sensors = useSensors(
    // pointer は 5px 動いてから drag 開始 (誤操作防止)
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    // タッチは長押し 200ms で drag 開始 (スクロールと両立させるため)
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 5 },
    }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const handleBack = () => {
    // replace: true がポイント。
    // - これにより /queue の履歴エントリは from で上書きされる
    // - 戻った先で OS の戻る（back）を押しても /queue には戻らない
    // - restoreScrollTop は App.tsx 側の useEffect が拾ってスクロール復元する
    navigate(from, {
      replace: true,
      state: { restoreScrollTop: scrollTop },
    })
  }

  const handleRemoveFromQueue = (index: number) => {
    musicPlayer.removeFromQueue(index)
  }

  const handlePlay = (track: Track) => {
    // クリックされた曲が queue 内のどこにいるか
    const index = queue.findIndex(t => t.id === track.id)
    if (index === -1) {
      musicPlayer.play(track)
      return
    }

    // 飛ばした曲(0..index-1)と現曲を history に積む。
    const skipped = queue.slice(0, index)
    const current = usePlayerStore.getState().currentTrack
    if (current) {
      musicPlayer.pushHistory(current)
    }
    for (const s of skipped) {
      musicPlayer.pushHistory(s)
    }

    // queue からクリック位置までを取り除く
    musicPlayer.setQueue(queue.slice(index + 1))

    // 再生開始
    musicPlayer.play(track)
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const fromIndex = queue.findIndex(t => t.id === active.id)
    const toIndex = queue.findIndex(t => t.id === over.id)
    if (fromIndex === -1 || toIndex === -1) return
    musicPlayer.moveInQueue(fromIndex, toIndex)
  }

  return (
    <div className="fade-in queue-page">
      <div className="queue-page-header">
        <div className="queue-page-header-left">
          <div
            className="queue-page-back-button"
            onClick={handleBack}
          >
            <Icon name='back' mode={null} size={24} folder='/images/App/' />
          </div>
          <p>{t.title}</p>
        </div>
        <div
          className="queue-page-header-right"
          ref={actionsBtnRef}
          onClick={e => {
            e.stopPropagation()
            setMenuOpen(o => !o)
          }}
        >
          <Icon name="ellipsis" mode={null} size={24} folder='/images/QueuePage/' />
        </div>
      </div>

      {menuOpen && (
        <ItemActionsMenu
          anchorEl={actionsBtnRef.current}
          items={menuItems}
          onClose={() => setMenuOpen(false)}
        />
      )}

      <div
        className="queue-page-list"
        style={{ paddingBottom: 'calc(24px + .8rem + 20px + .5rem)' }}
      >
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={queue.map(t => t.id)}
            strategy={verticalListSortingStrategy}
          >
            {queue.map((track, index) => (
              <SortableQueueItem
                key={track.id}
                track={track}
                onPlay={handlePlay}
                onRemove={() => handleRemoveFromQueue(index)}
              />
            ))}
          </SortableContext>
        </DndContext>
      </div>
    </div>
  )
}

interface SortableQueueItemProps {
  track: Track
  onPlay: (track: Track) => void
  onRemove: () => void
}

function SortableQueueItem({ track, onPlay, onRemove }: SortableQueueItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: track.id })

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(
      transform ? { ...transform, x: 0 } : null
    ),
    transition,
    // ドラッグ中の行は他より前面に出す
    zIndex: isDragging ? 1 : 0,
    opacity: isDragging ? 0.8 : 1,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="queue-page-item"
    >
      <div
        className="queue-page-item-handle"
        // listeners と attributes はハンドルにだけ付ける。
        // こうすることで MusicItem 本体のクリック (= 再生) を潰さない
        {...attributes}
        {...listeners}
      >
        <Icon name="hamburger" mode={null} size={24} folder='/images/QueuePage/' className='queue-page-item-handle-icon' />
      </div>
      <div className="queue-page-item-content">
        <MusicItem track={track} onPlay={onPlay} onRemove={onRemove} />
      </div>
    </div>
  )
}