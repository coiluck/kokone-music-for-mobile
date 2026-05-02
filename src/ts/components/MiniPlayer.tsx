import { useNavigate, useLocation } from 'react-router-dom'
import { useState, useRef, useCallback } from 'react'
import { usePlayerStore } from '../lib/playerStore'
import { musicPlayer } from '../lib/music'
import { Icon } from './Icon'
import { useSettingsStore } from '../lib/settingsStore'
import '../../css/components/MiniPlayer.css'

export function formatTime(ms: number): string {
  const totalSec = Math.floor(ms / 1000)
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

export default function MiniPlayer() {
  const navigate = useNavigate()
  const location = useLocation()

  const currentTrack = usePlayerStore(s => s.currentTrack)
  const isPlaying    = usePlayerStore(s => s.isPlaying)
  const positionMs   = usePlayerStore(s => s.positionMs)
  const durationMs   = usePlayerStore(s => s.durationMs)

  const iconStyle = useSettingsStore(s => s.iconStyle)

  // ドラッグ中だけ使うローカル state。null のときは store の値を表示する。
  const [draggingMs, setDraggingMs] = useState<number | null>(null)
  const trackRef = useRef<HTMLDivElement>(null)

  // clientX → ms に変換
  const clientXToMs = useCallback((clientX: number, max: number): number => {
    const el = trackRef.current
    if (!el) return 0
    const rect = el.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    return ratio * max
  }, [])

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (durationMs == null) return
    const max = durationMs
    e.currentTarget.setPointerCapture(e.pointerId)

    const ms = clientXToMs(e.clientX, max)
    setDraggingMs(ms)
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (draggingMs === null || durationMs == null) return
    const ms = clientXToMs(e.clientX, durationMs)
    setDraggingMs(ms)
  }

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (draggingMs === null) return
    e.currentTarget.releasePointerCapture(e.pointerId)
    musicPlayer.seek(draggingMs)
    setDraggingMs(null)
  }

  const handleOpenQueue = () => {
    if (location.pathname === '/queue') return
    const pageEl = document.querySelector('.page')
    const scrollTop = pageEl?.scrollTop ?? 0
    navigate('/queue', {
      state: { from: location.pathname, scrollTop },
    })
  }

  if (!currentTrack) {
    return <div className="player-component-container empty"></div>
  }

  const max = durationMs ?? 0
  const displayMs = draggingMs ?? positionMs
  const progress  = max > 0 ? Math.min(displayMs, max) / max : 0
  const dragging  = draggingMs !== null

  return (
    <div className="player-component-container">
      <div className='player-component-content'>
        <div className='player-component-icon-container'>
          <Icon name="music" mode={iconStyle} size={36} folder='/images/MiniPlayer/' />
        </div>

        <div className="player-component-info">
          <div className="player-component-info-title">
            {currentTrack.title ?? currentTrack.path.split('/').pop()}
          </div>
          <div className="player-component-info-meta">
            {currentTrack.artist ?? '—'}
            {currentTrack.tags.length !== 0 && (`・${currentTrack.tags}`)}
          </div>
        </div>

        <div className="player-component-button-container">
          <div className="player-component-control-button-container">
            <button
              className='player-component-control-button'
              onClick={() => void musicPlayer.prev()}
            >
              <Icon name='prev_text' mode={null} folder='/images/MiniPlayer/' color='rgb(from var(--color-text) r g b / 0.7)' />
            </button>
            <button
              className="player-component-control-button play"
              onClick={() => musicPlayer.togglePause()}
            >
              {isPlaying
                ? <Icon name='pause' mode={null} folder='/images/MiniPlayer/' />
                : <Icon name='play' mode={null} folder='/images/MiniPlayer/' /> }
            </button>
            <button
              className='player-component-control-button'
              onClick={() => void musicPlayer.next()}
            >
              <Icon name='next_text' mode={null} folder='/images/MiniPlayer/' color='rgb(from var(--color-text) r g b / 0.7)' />
            </button>
          </div>

          <div
            className='player-component-list-button'
            onClick={handleOpenQueue}
          >
            <Icon name='list-order' mode={iconStyle} folder='/images/MiniPlayer/' />
          </div>
        </div>
      </div>

      <div className="player-component-duration-container">
        <span>{formatTime(displayMs)}</span>

        <div
          ref={trackRef}
          className={`player-component-seek-container ${dragging ? 'dragging' : ''} ${durationMs == null ? 'disabled' : ''}`}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        >
          <div className="player-component-seek-track">
            <div
              className="player-component-seek-progress"
              style={{ width: `${progress * 100}%` }}
            />
            <div
              className="player-component-seek-thumb"
              style={{ left: `${progress * 100}%` }}
            />
          </div>
        </div>

        <span>{durationMs != null ? formatTime(durationMs) : '—'}</span>
      </div>
    </div>
  )
}