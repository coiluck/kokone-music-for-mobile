import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { getAllTracks, type Track } from '../lib/db'
import { useScanStore } from '../lib/scanStore'
import { musicPlayer } from '../lib/music'
import { usePlayerStore } from '../lib/playerStore'
import MusicItem from '../components/MusicItem'
import '../../css/pages/LibraryPage.css'

const INDICATOR_ITEM_HEIGHT = 20

function getFirstChar(title: string): string {
  if (!title) return '#' // titleは!nullだけど
  return Array.from(title)[0].toUpperCase()
}

function sortByTitle(tracks: Track[]): Track[] {
  return [...tracks].sort((a, b) =>
    (a.title ?? '').localeCompare(b.title ?? '', 'ja', { sensitivity: 'variant', numeric: true })
  )
}

export default function LibraryPage() {
  const [tracks, setTracks] = useState<Track[]>([])
  const [loading, setLoading] = useState(true)
  const [activeChar, setActiveChar] = useState<string | null>(null)
  const [currentChar, setCurrentChar] = useState<string | null>(null)
  const [visibleChars, setVisibleChars] = useState<string[]>([])
  const scanVersion = useScanStore(s => s.scanVersion)

  const isMiniPlayerVisible    = usePlayerStore(s => s.currentTrack)

  const listRef = useRef<HTMLDivElement | null>(null)
  const indicatorRef = useRef<HTMLDivElement | null>(null)
  const trackRefs = useRef<Record<string | number, HTMLDivElement | null>>({})
  // 現在 intersect しているトラックIDの集合
  const intersectingIdsRef = useRef<Set<string | number>>(new Set())

  const load = useCallback(async () => {
    setLoading(true)
    const result = await getAllTracks()
    trackRefs.current = {}
    intersectingIdsRef.current = new Set()
    setTracks(sortByTitle(result))
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
  }, [scanVersion, load])

  // 頭文字 -> その文字が最初に登場するトラックID
  const charToFirstTrackId = useMemo(() => {
    const acc: Record<string, Track['id']> = {}
    for (const t of tracks) {
      const ch = getFirstChar(t.title)
      if (!(ch in acc)) acc[ch] = t.id
    }
    return acc
  }, [tracks])

  // 登場順でユニークな頭文字リスト
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

  // インジケーター高さに応じて表示文字数を間引く
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

  // tracks の id -> index を引くマップ（intersect 中の最上要素を求める用）
  const trackIndexById = useMemo(() => {
    const m = new Map<string | number, number>()
    tracks.forEach((t, i) => m.set(t.id, i))
    return m
  }, [tracks])

  // IntersectionObserver でスクロール追従
  useEffect(() => {
    const listEl = listRef.current
    if (!listEl || tracks.length === 0) return

    const intersecting = intersectingIdsRef.current

    const updateCurrent = () => {
      if (intersecting.size === 0) return
      // intersect 中のうちリスト内で最も上（index が最小）の要素を採用
      let topIndex = Infinity
      for (const id of intersecting) {
        const idx = trackIndexById.get(id)
        if (idx != null && idx < topIndex) {
          topIndex = idx
        }
      }
      if (topIndex === Infinity) return
      const t = tracks[topIndex]
      if (!t) return
      const ch = getFirstChar(t.title)
      setCurrentChar(prev => (prev === ch ? prev : ch))
    }

    const io = new IntersectionObserver(
      entries => {
        for (const entry of entries) {
          const raw = (entry.target as HTMLElement).dataset.trackId
          if (raw == null) continue
          // ref のキーが数値の場合もあるので両方試す
          const numId = Number(raw)
          const key: string | number = Number.isNaN(numId) ? raw : numId
          if (entry.isIntersecting) {
            intersecting.add(key)
          } else {
            intersecting.delete(key)
          }
        }
        updateCurrent()
      },
      {
        root: listEl,
        // リスト上端付近のみを判定領域にする。
        // 下側を大きくマイナスにすることで、上端をまたいだ要素だけが intersecting になる。
        rootMargin: '-8px 0px -100% 0px',
        threshold: 0,
      }
    )

    for (const t of tracks) {
      const el = trackRefs.current[t.id]
      if (el) io.observe(el)
    }

    return () => {
      io.disconnect()
      intersecting.clear()
    }
  }, [tracks, trackIndexById])

  const scrollToChar = useCallback(
    (ch: string) => {
      setActiveChar(ch)
      const trackId = charToFirstTrackId[ch]
      const el = trackId != null ? trackRefs.current[trackId] : null
      const listEl = listRef.current
      if (el && listEl) {
        const listTop = listEl.getBoundingClientRect().top
        const elTop = el.getBoundingClientRect().top
        const target = listEl.scrollTop + (elTop - listTop) - 8
        listEl.scrollTo({ top: target, behavior: 'smooth' })
      }
      window.setTimeout(() => setActiveChar(null), 800)
    },
    [charToFirstTrackId]
  )

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

  return (
    <div className="page fade-in" style={{ paddingRight: 0, paddingBottom: 0 }}>
      <div className="library-toolbar">
        <span className="library-count">{tracks.length} 曲</span>
      </div>

      {loading ? (
        <p className="library-empty">読み込み中...</p>
      ) : tracks.length === 0 ? (
        <p className="library-empty">
          まだ曲がありません。設定からフォルダを追加してください。
        </p>
      ) : (
        <div
          className="library-main-container"
          style={{ marginBottom: isMiniPlayerVisible ? 'calc(24px + .8rem + 20px + .5rem)' : 0 }} /* MiniPlayerの高さ */
        >
          <div ref={listRef} className="library-music-item-container">
            {tracks.map(track => (
              <div
                key={track.id}
                data-track-id={track.id}
                ref={el => {
                  trackRefs.current[track.id] = el
                }}
              >
                <MusicItem track={track} onPlay={handlePlay} />
              </div>
            ))}
          </div>

          {/* スクロールインジケーター */}
          <div ref={indicatorRef} className="library-indicator">
            <div className="library-indicator-line" />
            {visibleChars.map(ch => (
              <button
                key={ch}
                type="button"
                onClick={() => scrollToChar(ch)}
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