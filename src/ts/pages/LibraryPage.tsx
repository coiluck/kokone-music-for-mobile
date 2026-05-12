import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { useLocation } from 'react-router-dom'
import { useVirtualizer } from '@tanstack/react-virtual'
import { getAllTracks, type Track } from '../lib/db'
import { useScanStore } from '../lib/scanStore'
import { musicPlayer } from '../lib/music'
import { usePlayerStore } from '../lib/playerStore'
import MusicItem from '../components/MusicItem'
import { useMappedTranslations } from '../lib/i18n'
import { loadVirtualizerInitial, saveVirtualizerState } from '../lib/scrollRestoration'
import '../../css/pages/LibraryPage.css'

const INDICATOR_ITEM_HEIGHT = 20
const ESTIMATED_ITEM_HEIGHT = 61.78
const SCROLL_OFFSET = 8
// MiniPlayer の高さ（CSS の calc(24px + .8rem + 20px + .5rem) と一致させる）
const MINI_PLAYER_HEIGHT_CSS = 'calc(24px + .8rem + 20px + .5rem)'

function getFirstChar(title: string): string {
  if (!title) return '#' // titleは!nullだけど
  return Array.from(title)[0].toUpperCase()
}

function sortByTitle(tracks: Track[]): Track[] {
  return [...tracks].sort((a, b) =>
    (a.title ?? '').localeCompare(b.title ?? '', 'ja', { sensitivity: 'variant', numeric: true })
  )
}

// CSS calc 値を実ピクセルに解決する（paddingEnd に数値で渡すため）
function resolveMiniPlayerHeightPx(): number {
  // 一時要素を生成して計算済み高さを取り出す
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
  const [tracks, setTracks] = useState<Track[]>([])
  const [loading, setLoading] = useState(true)
  const [activeChar, setActiveChar] = useState<string | null>(null)
  const [currentChar, setCurrentChar] = useState<string | null>(null)
  const [visibleChars, setVisibleChars] = useState<string[]>([])
  const [miniPlayerHeightPx, setMiniPlayerHeightPx] = useState(0)
  const scanVersion = useScanStore(s => s.scanVersion)
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
  // pointer 経由でジャンプを処理した直後の onClick を抑止するフラグ
  const pointerHandledRef = useRef(false)

  const load = useCallback(async () => {
    setLoading(true)
    const result = await getAllTracks()
    setTracks(sortByTitle(result))
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
  }, [scanVersion, load])

  // MiniPlayer の表示状態に応じて、末尾余白の実ピクセル値を更新
  useEffect(() => {
    if (isMiniPlayerVisible) {
      setMiniPlayerHeightPx(resolveMiniPlayerHeightPx())
    } else {
      setMiniPlayerHeightPx(0)
    }
  }, [isMiniPlayerVisible])

  const charToFirstIndex = useMemo(() => {
    const acc: Record<string, number> = {}
    tracks.forEach((t, i) => {
      const ch = getFirstChar(t.title)
      if (!(ch in acc)) acc[ch] = i
    })
    return acc
  }, [tracks])

  const allChars = useMemo(() => {
    const seen = new Set<string>()
    const result: string[] = []
    for (const t of tracks) {
      const ch = getFirstChar(t.title)
      if (!seen.has(ch)) {
        seen.add(ch)
        result.push(ch)
      }
    }
    return result
  }, [tracks])

  // useVirtualizer の constructor 時点で読み込まないと意味がないので useMemo
  // で pathname 単位に固定する。measurementsCache も復元しないと measureElement
  // ベースのレイアウトが正しい位置に items を並べてくれず、復元が崩れる。
  const initialRestoration = useMemo(
    () => loadVirtualizerInitial(pathname),
    [pathname],
  )

  const virtualizer = useVirtualizer({
    count: tracks.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => ESTIMATED_ITEM_HEIGHT,
    overscan: 8,
    paddingStart: SCROLL_OFFSET,
    // MiniPlayer の裏に最後の曲が隠れないよう、末尾に余白を確保
    paddingEnd: miniPlayerHeightPx,
    getItemKey: i => tracks[i]?.id ?? i,
    initialOffset: initialRestoration.initialOffset,
    initialMeasurementsCache: initialRestoration.initialMeasurementsCache,
    onChange: instance => {
      // スクロール停止時の安定した状態だけを保存する
      if (!instance.isScrolling) {
        saveVirtualizerState(pathname, instance.scrollOffset, instance.measurementsCache)
      }
    },
  })

  // unmount 時 (= ページ離脱時) は isScrolling のタイミングに頼れないので
  // 必ず最後の状態を flush する。
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
    if (tracks.length === 0 || virtualItems.length === 0) return
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

    const t = tracks[topIndex]
    if (!t) return
    const ch = getFirstChar(t.title)
    setCurrentChar(prev => (prev === ch ? prev : ch))
  }, [virtualItems, tracks])

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
      // pointer 経由で既にジャンプ済みなら何もしない（クリック発火を抑止）
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

      // この後に発火する onClick を 1 回だけ抑止する
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
    (track: Track) => {
      const i = tracks.findIndex(t => t.id === track.id)
      if (i === -1) {
        void musicPlayer.play(track)
        return
      }
      // クリック曲の後ろ → 先頭からクリック曲の一個前まで、で一周分
      const queue = [...tracks.slice(i + 1), ...tracks.slice(0, i)]
      musicPlayer.setQueue(queue)
      void musicPlayer.play(track)
    },
    [tracks]
  )

  const totalSize = virtualizer.getTotalSize()

  return (
    <div className="page fade-in" style={{ paddingRight: 0, paddingBottom: 0 }}>
      <div className="library-toolbar">
        <span className="library-count">{tracks.length} {t.count}</span>
      </div>

      {loading ? (
        <p className="library-empty">{t.loading}</p>
      ) : tracks.length === 0 ? (
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
                const track = tracks[vi.index]
                if (!track) return null
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
                    <MusicItem track={track} onPlay={handlePlay} />
                  </div>
                )
              })}
            </div>
          </div>

          {/* スクロールインジケーター */}
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