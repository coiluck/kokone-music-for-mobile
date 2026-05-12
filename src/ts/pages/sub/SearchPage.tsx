import { useEffect, useState, useCallback, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { getAllTracks, searchTracks, type Track } from '../../lib/db'
import { useScanStore } from '../../lib/scanStore'
import { musicPlayer } from '../../lib/music'
import { usePlayerStore } from '../../lib/playerStore'
import { useMappedTranslations } from '../../lib/i18n'
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
  const initialTags = (location.state?.initialTags as string[] | undefined) ?? []

  const [tracks, setTracks] = useState<Track[]>([])
  const [query, setQuery] = useState('')
  const [tags, setTags] = useState<string[]>(initialTags)
  const [loading, setLoading] = useState(false)
  const scanVersion = useScanStore(s => s.scanVersion)
  const inputRef = useRef<HTMLInputElement>(null)
  const isMiniPlayerVisible = usePlayerStore(s => s.currentTrack)

  useEffect(() => {
    if (initialTags.length > 0) {
      setTags(prev => {
        // 重複しないようマージ
        const merged = [...prev]
        for (const tag of initialTags) {
          if (!merged.includes(tag)) merged.push(tag)
        }
        return merged
      })
    }
  }, [location.key])

  const load = useCallback(async (q: string, currentTags: string[]) => {
    setLoading(true)
    const result = q.trim() || currentTags.length > 0
      ? await searchTracks(q, currentTags)
      : await getAllTracks()
    setTracks(result)
    setLoading(false)
  }, [])

  useEffect(() => {
    load(query, tags)
  }, [scanVersion, query, tags, load])

  useEffect(() => {
    if (initialTags.length > 0) return;
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [location.key])

  const handleClear = () => {
    setQuery('')
    setTags([])
  }

  const handleBack = () => {
    navigate(from, {
      replace: true,
      state: { restoreScrollTop: scrollTop },
    })
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return
    if (e.key !== 'Enter') return

    const value = query.trim()
    if (!value) return
    if (tags.includes(value)) {
      setQuery('')
      return
    }

    setTags(prev => [...prev, value])
    setQuery('')
  }

  return (
    <div className="page fade-in" style={{ paddingBottom: 0 }}>
      <div className="search-page-header">
        <div className="search-page-input-container">
          <div className="search-page-input-tags-container">
            {tags.map(tag => (
              <span
                key={tag}
                className="search-page-input-tags-item"
                onClick={() => setTags(prev => prev.filter(t => t !== tag))}
              >
                {tag}
              </span>
            ))}
          </div>
          <input
            ref={inputRef}
            className="search-page-input"
            type="text"
            placeholder={t.placeholder}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
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
          {query || tags.length > 0 ? t.noItem : t.noWord}
        </p>
      ) : (
        <div
          className="search-page-music-item-container"
          style={{ paddingBottom: isMiniPlayerVisible ? 'calc(24px + .8rem + 20px + .5rem)' : 0 }}
        >
          {tracks.map((track, i) => (
            <MusicItem key={track.id ?? i} track={track} onPlay={() => void musicPlayer.play(track)} />
          ))}
        </div>
      )}
    </div>
  )
}