import { useEffect, useState, useCallback, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { getAllTracks, searchTracks, type Track } from '../../lib/db'
import { useScanStore } from '../../lib/scanStore'
import { musicPlayer } from '../../lib/music'
import { usePlayerStore } from '../../lib/playerStore'
import { useMappedTranslations } from '../../lib/i18n'
import { formatTime } from '../../components/MiniPlayer'
import MusicItem from '../../components/MusicItem'
import '../../../css/pages/sub/SearchPage.css'

export default function SearchPage() {
  const navigate = useNavigate()
  const location = useLocation()

  const t = useMappedTranslations({
    placeholder: 'search.input.placeholder',
    cancel: 'search.cancel',
    loading: 'search.loading',
    noItem: 'search.noItem',
    noWord: 'search.noWord',
    count: 'search.count',
  })


  const from = (location.state?.from as string | undefined) ?? '/'
  const scrollTop = (location.state?.scrollTop as number | undefined) ?? 0

  const [tracks, setTracks] = useState<Track[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const scanVersion = useScanStore(s => s.scanVersion)
  const inputRef = useRef<HTMLInputElement>(null)
  const isMiniPlayerVisible    = usePlayerStore(s => s.currentTrack)

  const load = useCallback(async (q: string) => {
    setLoading(true)
    const result = q.trim() ? await searchTracks(q) : await getAllTracks()
    setTracks(result)
    setLoading(false)
  }, [])

  useEffect(() => {
    load(query)
  }, [scanVersion, query, load])

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [location.key])

  const handleClear = () => {
    setQuery('')
  }

  const handleBack = () => {
    navigate(from, {
      replace: true,
      state: { restoreScrollTop: scrollTop },
    })
  }

  return (
    <div className="page fade-in" style={{ paddingBottom: 0 }}>
      <div className="search-page-header">
        <div className="search-page-input-container">
          <input
            ref={inputRef}
            className="search-page-header-input"
            type="text"
            placeholder={t.placeholder}
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
          <div 
            className="search-page-input-clear"
            onClick={handleClear}
          />
        </div>
        <button
          className="search-page-header-back"
          onClick={handleBack}
          aria-label="back"
        >
          {t.cancel}
        </button>
      </div>

      
      <span className="search-page-music-count">{tracks.length} {t.count}</span>

      {loading ? (
        <p className="library-empty">{t.loading}</p>
      ) : tracks.length === 0 ? (
        <p className="library-empty">
          {query ? t.noItem : t.noWord}
        </p>
      ) : (
        <div 
          className="search-page-music-item-container"
          style={{ paddingBottom: isMiniPlayerVisible ? 'calc(24px + .8rem + 20px + .5rem)' : 0 }} /* MiniPlayerの高さ */
        >
          {tracks.map((track, i) => (
            <MusicItem track={track} onPlay={() => void musicPlayer.play(track)} />
          ))}
        </div>
      )}
    </div>
  )
}