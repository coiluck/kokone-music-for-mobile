import { useEffect, useCallback, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { playFromList } from '../../lib/trackActions'
import { usePlayerStore } from '../../lib/playerStore'
import { useMappedTranslations } from '../../lib/i18n'
import { useTrackSearch } from '../../lib/useTrackSearch'
import MusicItem from '../../components/MusicItem'
import SearchInput from '../../components/SearchInput'
import '../../../css/pages/sub/SearchPage.css'

export default function SearchPage() {
  const navigate = useNavigate()
  const location = useLocation()

  const t = useMappedTranslations({
    cancel: 'search.cancel',
    loading: 'search.loading',
    noItem: 'search.noItem',
    noWord: 'search.noWord',
    count: 'search.count',
  })

  const initialTags = (location.state?.initialTags as string[] | undefined) ?? []

  const { trackIds, query, setQuery, tags, setTags, loading } = useTrackSearch(initialTags)
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

  useEffect(() => {
    if (initialTags.length > 0) return;
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [location.key])

  const handlePlay = useCallback(
    (trackId: number) => playFromList(trackIds, trackId),
    [trackIds]
  )

  return (
    <div className="page fade-in" style={{ paddingBottom: 0 }}>
      <div className="search-page-header">
        <SearchInput
          query={query}
          setQuery={setQuery}
          tags={tags}
          setTags={setTags}
          inputRef={inputRef}
        />
        <button
          className="search-page-header-back"
          onClick={() => navigate(-1)}
          aria-label="back"
        >
          {t.cancel}
        </button>
      </div>

      <span className="search-page-music-count">{trackIds.length} {t.count}</span>

      {loading ? (
        <p className="library-empty">{t.loading}</p>
      ) : trackIds.length === 0 ? (
        <p className="library-empty">
          {query || tags.length > 0 ? t.noItem : t.noWord}
        </p>
      ) : (
        <div
          className="search-page-music-item-container"
          style={{ paddingBottom: isMiniPlayerVisible ? 'calc(24px + .8rem + 20px + .5rem)' : 0 }}
        >
          {trackIds.map(id => (
            <MusicItem key={id} trackId={id} onPlay={handlePlay} />
          ))}
        </div>
      )}
    </div>
  )
}
