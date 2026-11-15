import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { addTrackToPlaylist, getPlaylists, removeTrackFromPlaylist, type Playlist } from '../../lib/db'
import { playFromList } from '../../lib/trackActions'
import { usePlayerStore } from '../../lib/playerStore'
import { useMappedTranslations } from '../../lib/i18n'
import { useTrackSearch } from '../../lib/useTrackSearch'
import MusicItem from '../../components/MusicItem'
import PlaylistAddButton from '../../components/PlaylistAddButton'
import SearchInput from '../../components/SearchInput'
import '../../../css/pages/sub/SearchPage.css'
import '../../../css/pages/sub/PlaylistAddPage.css'

export default function PlaylistAddPage() {
  const { name } = useParams<{ name: string }>()
  const navigate = useNavigate()

  const t = useMappedTranslations({
    done: 'playlist.add.done',
    target: 'playlist.add.target',
    loading: 'search.loading',
    noItem: 'search.noItem',
    noWord: 'search.noWord',
    count: 'search.count',
  })

  const { trackIds, query, setQuery, tags, setTags, loading } = useTrackSearch()
  const [playlist, setPlaylist] = useState<Playlist | null>(null)
  const isMiniPlayerVisible = usePlayerStore(s => s.currentTrack)

  // 絞り込みで行が消えても追加済みの表示を保つため、ボタンとは別にここでも持つ
  const addedIdsRef = useRef(new Set<number>())
  // addTrackToPlaylist は読み取ってから書き戻すので、同時に走らせると追加が消える
  const writeQueueRef = useRef<Promise<void>>(Promise.resolve())

  useEffect(() => {
    getPlaylists().then(playlists => {
      const pl = playlists.find(p => p.name === name)
      if (!pl) return
      addedIdsRef.current = new Set(pl.trackIds)
      setPlaylist(pl)
    })
  }, [name])

  const handleToggle = useCallback((trackId: number, added: boolean) => {
    if (!playlist) return Promise.resolve()
    const setAdded = (value: boolean) => {
      if (value) addedIdsRef.current.add(trackId)
      else addedIdsRef.current.delete(trackId)
    }
    // 書き込み中に行が作り直されても表示が戻らないよう、先に反映する
    setAdded(added)
    const write = writeQueueRef.current
      .then(() => added
        ? addTrackToPlaylist(playlist.id, trackId)
        : removeTrackFromPlaylist(playlist.id, trackId))
      .catch(e => {
        setAdded(!added)
        throw e
      })
    // 失敗しても後続の書き込みは続ける
    writeQueueRef.current = write.catch(() => {})
    return write
  }, [playlist])

  const handlePlay = useCallback(
    (trackId: number) => playFromList(trackIds, trackId),
    [trackIds]
  )

  return (
    <div className="page fade-in" style={{ paddingBottom: 0 }}>
      <div className="search-page-header">
        <SearchInput query={query} setQuery={setQuery} tags={tags} setTags={setTags} />
        <button
          className="search-page-header-back"
          onClick={() => navigate(-1)}
          aria-label="back"
        >
          {t.done}
        </button>
      </div>

      <div className="playlist-add-target">{t.target}: {name}</div>
      
      {loading || !playlist ? (
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
            <MusicItem
              key={id}
              trackId={id}
              onPlay={handlePlay}
              action={
                <PlaylistAddButton
                  trackId={id}
                  initialAdded={addedIdsRef.current.has(id)}
                  onToggle={handleToggle}
                />
              }
            />
          ))}
        </div>
      )}
    </div>
  )
}
