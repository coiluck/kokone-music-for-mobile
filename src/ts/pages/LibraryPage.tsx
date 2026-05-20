import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { useLocation } from 'react-router-dom'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useTrackStore } from '../lib/trackStore'
import { musicPlayer } from '../lib/music'
import { usePlayerStore } from '../lib/playerStore'
import MusicItem from '../components/MusicItem'
import { useMappedTranslations } from '../lib/i18n'
import { loadVirtualizerInitial, saveVirtualizerState } from '../lib/scrollRestoration'
import '../../css/pages/LibraryPage.css'

const INDICATOR_ITEM_HEIGHT = 20
const ESTIMATED_ITEM_HEIGHT = 61.78
const SCROLL_OFFSET = 8
const MINI_PLAYER_HEIGHT_CSS = 'calc(24px + .8rem + 20px + .5rem)'

function getFirstChar(title: string): string {
  if (!title) return '#'
  return Array.from(title)[0].toUpperCase()
}

function resolveMiniPlayerHeightPx(): number {
  const probe = document.createElement('div')
  probe.style.position = 'absolute'
  probe.style.visibility = 'hidden'
  probe.style.height = MINI_PLAYER_HEIGHT_CSS
  document.body.appendChild(probe)
  const h = probe.getBoundingClientRect().height
  document.body.removeChild(probe)
  return h
}

export default function LibraryPage() {
  // store から購読（hydrate は main.tsx で起動時 + scanVersion 変化時に行う）
  const trackOrder = useTrackStore(s => s.trackOrder)
  const tracksById = useTrackStore(s => s.tracksById)
  const loading = useTrackStore(s => s.loading)

  const [activeChar, setActiveChar] = useState<string | null>(null)
  const [currentChar, setCurrentChar] = useState<string | null>(null)
  const [visibleChars, setVisibleChars] = useState<string[]>([])
  const [miniPlayerHeightPx, setMiniPlayerHeightPx] = useState(0)
  const { pathname } = useLocation()

  const t = useMappedTranslations({
    count: 'library.count',
    empty: 'library.empty',
    loading: 'library.loading',
  })

  const isMiniPlayerVisible = usePlayerStore(s => s.currentTrack)

  const listRef = useRef<HTMLDivElement | null>(null)
  const indicatorRef = useRef<HTMLDivElement | null>(null)
  const lastDraggedCharRef = useRef<string | null>(null)
  const isDraggingRef = useRef(false)
  const activeCharTimerRef = useRef<number | null>(null)
  const pointerHandledRef = useRef(false)

  useEffect(() => {
    if (isMiniPlayerVisible) {
      setMiniPlayerHeightPx(resolveMiniPlayerHeightPx())
    } else {
      setMiniPlayerHeightPx(0)
    }
  }, [isMiniPlayerVisible])

  // インジケータ用に、trackOrder を1パス走査して
  // allChars と charToFirstIndex を同時に構築する
  const { allChars, charToFirstIndex } = useMemo(() => {
    const seen = new Set<string>()
    const chars: string[] = []
    const firstIndex: Record<string, number> = {}
    trackOrder.forEach((id, i) => {
      const track = tracksById[id]
      if (!track) return
      const ch = getFirstChar(track.title)
      if (!seen.has(ch)) {
        seen.add(ch)
        chars.push(ch)
        firstIndex[ch] = i
      }
    })
    return { allChars: chars, charToFirstIndex: firstIndex }
  }, [trackOrder, tracksById])

  const initialRestoration = useMemo(
    () => loadVirtualizerInitial(pathname),
    [pathname],
  )

  const virtualizer = useVirtualizer({
    count: trackOrder.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => ESTIMATED_ITEM_HEIGHT,
    overscan: 8,
    paddingStart: SCROLL_OFFSET,
    paddingEnd: miniPlayerHeightPx,
    getItemKey: i => trackOrder[i] ?? i,
    initialOffset: initialRestoration.initialOffset,
    initialMeasurementsCache: initialRestoration.initialMeasurementsCache,
    onChange: instance => {
      if (!instance.isScrolling) {
        saveVirtualizerState(pathname, instance.scrollOffset, instance.measurementsCache)
      }
    },
  })

  useEffect(() => {
    return () => {
      saveVirtualizerState(pathname, virtualizer.scrollOffset, virtualizer.measurementsCache)
    }
  }, [pathname, virtualizer])

  const virtualItems = virtualizer.getVirtualItems()

  const recalc = useCallback(() => {
    if (!indicatorRef.current) return
    const h = indicatorRef.current.clientHeight
    const max = Math.floor(h / INDICATOR_ITEM_HEIGHT)
    if (allChars.length === 0) {
      setVisibleChars([])
      return
    }
    if (allChars.length <= max) {
      setVisibleChars(allChars)
      return
    }
    if (max <= 1) {
      setVisibleChars([allChars[0]])
      return
    }
    const result: string[] = []
    for (let i = 0; i < max; i++) {
      const idx = Math.round((i * (allChars.length - 1)) / (max - 1))
      result.push(allChars[idx])
    }
    setVisibleChars([...new Set(result)])
  }, [allChars])

  useEffect(() => {
    recalc()
    const ro = new ResizeObserver(recalc)
    if (indicatorRef.current) ro.observe(indicatorRef.current)
    return () => ro.disconnect()
  }, [recalc])

  useEffect(() => {
    if (trackOrder.length === 0 || virtualItems.length === 0) return
    if (isDraggingRef.current) return
    const listEl = listRef.current
    if (!listEl) return

    const probe = listEl.scrollTop + SCROLL_OFFSET

    let topIndex = virtualItems[0].index
    for (const vi of virtualItems) {
      if (vi.start <= probe) {
        topIndex = vi.index
      } else {
        break
      }
    }

    const id = trackOrder[topIndex]
    const track = tracksById[id]
    if (!track) return
    const ch = getFirstChar(track.title)
    setCurrentChar(prev => (prev === ch ? prev : ch))
  }, [virtualItems, trackOrder, tracksById])

  const jumpToChar = useCallback(
    (ch: string, smooth: boolean) => {
      const idx = charToFirstIndex[ch]
      if (idx == null) return
      virtualizer.scrollToIndex(idx, {
        align: 'start',
        behavior: smooth ? 'smooth' : 'auto',
      })
    },
    [charToFirstIndex, virtualizer]
  )

  const handleIndicatorClick = useCallback(
    (ch: string) => {
      if (pointerHandledRef.current) {
        pointerHandledRef.current = false
        return
      }
      setActiveChar(ch)
      jumpToChar(ch, true)
      if (activeCharTimerRef.current != null) {
        window.clearTimeout(activeCharTimerRef.current)
      }
      activeCharTimerRef.current = window.setTimeout(() => {
        setActiveChar(null)
        activeCharTimerRef.current = null
      }, 800)
    },
    [jumpToChar]
  )

  const getCharAtY = useCallback((clientY: number): string | null => {
    const indicatorEl = indicatorRef.current
    if (!indicatorEl) return null
    const buttons = indicatorEl.querySelectorAll<HTMLButtonElement>('.library-indicator-item')
    if (buttons.length === 0) return null

    const indicatorRect = indicatorEl.getBoundingClientRect()
    const clampedY = Math.max(indicatorRect.top, Math.min(indicatorRect.bottom, clientY))

    let bestCh: string | null = null
    let bestDist = Infinity
    for (const btn of Array.from(buttons)) {
      const r = btn.getBoundingClientRect()
      const center = (r.top + r.bottom) / 2
      const dist = Math.abs(center - clampedY)
      if (dist < bestDist) {
        bestDist = dist
        bestCh = btn.textContent
      }
    }
    return bestCh
  }, [])

  const handleIndicatorPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const ch = getCharAtY(e.clientY)
      if (ch == null) return

      pointerHandledRef.current = true

      isDraggingRef.current = true
      lastDraggedCharRef.current = ch
      if (activeCharTimerRef.current != null) {
        window.clearTimeout(activeCharTimerRef.current)
        activeCharTimerRef.current = null
      }
      setActiveChar(ch)
      jumpToChar(ch, false)

      try {
        e.currentTarget.setPointerCapture(e.pointerId)
      } catch {
        // noop
      }
    },
    [getCharAtY, jumpToChar]
  )

  const handleIndicatorPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!isDraggingRef.current) return
      const ch = getCharAtY(e.clientY)
      if (ch == null) return
      if (ch === lastDraggedCharRef.current) return
      lastDraggedCharRef.current = ch
      setActiveChar(ch)
      jumpToChar(ch, false)
    },
    [getCharAtY, jumpToChar]
  )

  const endDrag = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current) return
    isDraggingRef.current = false
    lastDraggedCharRef.current = null
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      // noop
    }
    if (activeCharTimerRef.current != null) {
      window.clearTimeout(activeCharTimerRef.current)
    }
    activeCharTimerRef.current = window.setTimeout(() => {
      setActiveChar(null)
      activeCharTimerRef.current = null
    }, 400)
  }, [])

  useEffect(() => {
    return () => {
      if (activeCharTimerRef.current != null) {
        window.clearTimeout(activeCharTimerRef.current)
      }
    }
  }, [])

  const handlePlay = useCallback(
    (trackId: number) => {
      // store の最新状態を直接参照（クロージャの古い値を使わない）
      const state = useTrackStore.getState()
      const order = state.trackOrder
      const byId = state.tracksById

      const i = order.indexOf(trackId)
      const track = byId[trackId]
      if (!track) return

      if (i === -1) {
        void musicPlayer.play(track)
        return
      }
      // クリック曲の後ろ → 先頭からクリック曲の一個前まで、で一周分
      const queueIds = [...order.slice(i + 1), ...order.slice(0, i)]
      const queue = queueIds.map(id => byId[id]).filter(Boolean)
      musicPlayer.setQueue(queue)
      void musicPlayer.play(track)
    },
    []
  )

  const totalSize = virtualizer.getTotalSize()

  return (
    <div className="page fade-in" style={{ paddingRight: 0, paddingBottom: 0 }}>
      <div className="library-toolbar">
        <span className="library-count">{trackOrder.length} {t.count}</span>
      </div>

      {loading ? (
        <p className="library-empty">{t.loading}</p>
      ) : trackOrder.length === 0 ? (
        <p className="library-empty">
          {t.empty}
        </p>
      ) : (
        <div className="library-main-container">
          <div ref={listRef} className="library-music-item-container">
            <div
              style={{
                height: totalSize,
                width: '100%',
                position: 'relative',
              }}
            >
              {virtualItems.map(vi => {
                const id = trackOrder[vi.index]
                if (id == null) return null
                return (
                  <div
                    key={vi.key}
                    data-index={vi.index}
                    ref={virtualizer.measureElement}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      transform: `translateY(${vi.start}px)`,
                    }}
                  >
                    <MusicItem trackId={id} onPlay={handlePlay} />
                  </div>
                )
              })}
            </div>
          </div>

          <div
            ref={indicatorRef}
            className="library-indicator"
            style={{
              bottom: isMiniPlayerVisible ? MINI_PLAYER_HEIGHT_CSS : 0,
            }}
            onPointerDown={handleIndicatorPointerDown}
            onPointerMove={handleIndicatorPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            <div className="library-indicator-line" />
            {visibleChars.map(ch => (
              <button
                key={ch}
                type="button"
                onClick={() => handleIndicatorClick(ch)}
                className={
                  'library-indicator-item' +
                  (activeChar === ch || (activeChar === null && currentChar === ch)
                    ? ' is-active'
                    : '')
                }
              >
                {ch}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}