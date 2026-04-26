import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { getAllTracks, type Track } from '../lib/db'
import { useScanStore } from '../lib/scanStore'
import { usePlayerStore } from '../lib/playerStore'
import ArtistItem from '../components/ArtistItem'
import { useMappedTranslations } from '../lib/i18n'
import '../../css/pages/ArtistlistsPage.css'

const INDICATOR_ITEM_HEIGHT = 20
const ESTIMATED_ITEM_HEIGHT = 61.78
const SCROLL_OFFSET = 8
// MiniPlayer の高さ（CSS の calc(24px + .8rem + 20px + .5rem) と一致させる）
const MINI_PLAYER_HEIGHT_CSS = 'calc(24px + .8rem + 20px + .5rem)'

interface ArtistEntry {
  name: string
  tracksNumber: number
}

function getFirstChar(name: string): string {
  if (!name) return '#'
  return Array.from(name)[0].toUpperCase()
}

function aggregateArtists(tracks: Track[]): ArtistEntry[] {
  const map = new Map<string, number>()
  for (const t of tracks) {
    const name = t.artist ?? ''
    map.set(name, (map.get(name) ?? 0) + 1)
  }
  const result: ArtistEntry[] = []
  for (const [name, tracksNumber] of map) {
    result.push({ name, tracksNumber })
  }
  return result.sort((a, b) =>
    a.name.localeCompare(b.name, 'ja', { sensitivity: 'variant', numeric: true })
  )
}

// CSS calc 値を実ピクセルに解決する（paddingEnd に数値で渡すため）
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

export default function ArtistlistsPage() {
  const [artists, setArtists] = useState<ArtistEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [activeChar, setActiveChar] = useState<string | null>(null)
  const [currentChar, setCurrentChar] = useState<string | null>(null)
  const [visibleChars, setVisibleChars] = useState<string[]>([])
  const [miniPlayerHeightPx, setMiniPlayerHeightPx] = useState(0)
  const scanVersion = useScanStore(s => s.scanVersion)

  const t = useMappedTranslations({
    count: 'artist.list.count',
    empty: 'artist.list.empty',
    loading: 'artist.list.loading',
  })

  const isMiniPlayerVisible = usePlayerStore(s => s.currentTrack)

  const listRef = useRef<HTMLDivElement | null>(null)
  const indicatorRef = useRef<HTMLDivElement | null>(null)
  const lastDraggedCharRef = useRef<string | null>(null)
  const isDraggingRef = useRef(false)
  const activeCharTimerRef = useRef<number | null>(null)
  const pointerHandledRef = useRef(false)

  const load = useCallback(async () => {
    setLoading(true)
    const result = await getAllTracks()
    setArtists(aggregateArtists(result))
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
  }, [scanVersion, load])

  useEffect(() => {
    if (isMiniPlayerVisible) {
      setMiniPlayerHeightPx(resolveMiniPlayerHeightPx())
    } else {
      setMiniPlayerHeightPx(0)
    }
  }, [isMiniPlayerVisible])

  const charToFirstIndex = useMemo(() => {
    const acc: Record<string, number> = {}
    artists.forEach((a, i) => {
      const ch = getFirstChar(a.name)
      if (!(ch in acc)) acc[ch] = i
    })
    return acc
  }, [artists])

  const allChars = useMemo(() => {
    const seen = new Set<string>()
    const result: string[] = []
    for (const a of artists) {
      const ch = getFirstChar(a.name)
      if (!seen.has(ch)) {
        seen.add(ch)
        result.push(ch)
      }
    }
    return result
  }, [artists])

  const virtualizer = useVirtualizer({
    count: artists.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => ESTIMATED_ITEM_HEIGHT,
    overscan: 8,
    paddingStart: SCROLL_OFFSET,
    paddingEnd: miniPlayerHeightPx,
    getItemKey: i => artists[i]?.name ?? i,
  })

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
    if (artists.length === 0 || virtualItems.length === 0) return
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

    const a = artists[topIndex]
    if (!a) return
    const ch = getFirstChar(a.name)
    setCurrentChar(prev => (prev === ch ? prev : ch))
  }, [virtualItems, artists])

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
    const buttons = indicatorEl.querySelectorAll<HTMLButtonElement>('.artist-list-indicator-item')
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

  const totalSize = virtualizer.getTotalSize()

  return (
    <div className="page fade-in" style={{ paddingRight: 0, paddingBottom: 0 }}>
      <div className="artist-list-toolbar">
        <span className="artist-list-count">{artists.length} {t.count}</span>
      </div>

      {loading ? (
        <p className="artist-list-empty">{t.loading}</p>
      ) : artists.length === 0 ? (
        <p className="artist-list-empty">
          {t.empty}
        </p>
      ) : (
        <div className="artist-list-main-container">
          <div ref={listRef} className="artist-list-music-item-container">
            <div
              style={{
                height: totalSize,
                width: '100%',
                position: 'relative',
              }}
            >
              {virtualItems.map(vi => {
                const artist = artists[vi.index]
                if (!artist) return null
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
                    <ArtistItem
                      artistName={artist.name}
                      artistTracksNumber={artist.tracksNumber}
                    />
                  </div>
                )
              })}
            </div>
          </div>

          {/* スクロールインジケーター */}
          <div
            ref={indicatorRef}
            className="artist-list-indicator"
            style={{
              bottom: isMiniPlayerVisible ? MINI_PLAYER_HEIGHT_CSS : 0,
            }}
            onPointerDown={handleIndicatorPointerDown}
            onPointerMove={handleIndicatorPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            <div className="artist-list-indicator-line" />
            {visibleChars.map(ch => (
              <button
                key={ch}
                type="button"
                onClick={() => handleIndicatorClick(ch)}
                className={
                  'artist-list-indicator-item' +
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