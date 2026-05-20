import { useState, useEffect, useCallback, useMemo } from 'react'
import { useParams } from 'react-router-dom'
import { getAllTracks, type Track } from '../lib/db'
import { useTrackStore } from '../lib/trackStore'
import { musicPlayer } from '../lib/music'
import { useSettingsStore } from '../lib/settingsStore'
import { usePlayerStore } from '../lib/playerStore'
import { useMappedTranslations } from '../lib/i18n'
import { Icon } from '../components/Icon'
import { formatTime } from '../components/MiniPlayer'
import MusicItem from '../components/MusicItem'
import '../../css/pages/ArtistPage.css'

function sortByTitle(tracks: Track[]): Track[] {
  return [...tracks].sort((a, b) =>
    (a.title ?? '').localeCompare(b.title ?? '', 'ja', {
      sensitivity: 'variant',
      numeric: true,
    })
  )
}

export default function ArtistPage() {
  const { name } = useParams<{ name: string }>()
  const artistName = name ? decodeURIComponent(name) : ''

  const [trackIds, setTrackIds] = useState<number[]>([])
  const tracksById = useTrackStore(s => s.tracksById)

  const t = useMappedTranslations({
    tracksNumber: 'artist.item.tracksNumber',
  })

  const iconStyle = useSettingsStore(s => s.iconStyle)
  const isMiniPlayerVisible = usePlayerStore(s => s.currentTrack)

  useEffect(() => {
    getAllTracks().then(all => {
      const filtered = all.filter(t => (t.artist ?? '') === artistName)
      const sorted = sortByTitle(filtered)
      setTrackIds(sorted.map(x => x.id))
    })
  }, [artistName])

  const totalDurationMs = useMemo(
    () => trackIds.reduce((sum, id) => sum + (tracksById[id]?.duration_ms ?? 0), 0),
    [trackIds, tracksById]
  )

  const handlePlay = useCallback(
    (trackId: number) => {
      const byId = useTrackStore.getState().tracksById
      const track = byId[trackId]
      if (!track) return

      const i = trackIds.indexOf(trackId)
      if (i === -1) {
        void musicPlayer.play(track)
        return
      }
      const queueIds = [...trackIds.slice(i + 1), ...trackIds.slice(0, i)]
      const queue = queueIds.map(id => byId[id]).filter((t): t is Track => Boolean(t))
      musicPlayer.setQueue(queue)
      void musicPlayer.play(track)
    },
    [trackIds]
  )

  const handleShuffle = useCallback(() => {
    if (trackIds.length === 0) return
    const byId = useTrackStore.getState().tracksById
    // Fisher-Yates
    const shuffled = [...trackIds]
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
    }
    const tracks = shuffled.map(id => byId[id]).filter((t): t is Track => Boolean(t))
    if (tracks.length === 0) return
    const [first, ...rest] = tracks
    musicPlayer.setQueue(rest)
    void musicPlayer.play(first)
  }, [trackIds])

  const handlePlayAll = useCallback(() => {
    if (trackIds.length === 0) return
    const byId = useTrackStore.getState().tracksById
    const tracks = trackIds.map(id => byId[id]).filter((t): t is Track => Boolean(t))
    if (tracks.length === 0) return
    const [first, ...rest] = tracks
    musicPlayer.setQueue(rest)
    void musicPlayer.play(first)
  }, [trackIds])

  return (
    <div className="page fade-in" style={{ paddingBottom: 0 }}>
      <div className="artist-page-topbar">
        <div className="artist-page-topbar-left">
          <div className="artist-page-topbar-icon-container">
            <Icon name="artist" mode={iconStyle} size={24} folder="/images/ArtistPage/" />
          </div>
          <div className="artist-page-topbar-text">
            <p className="artist-page-topbar-text-title">{artistName}</p>
            <p className="artist-page-topbar-text-meta">{trackIds.length} {t.tracksNumber}・{formatTime(totalDurationMs)}</p>
          </div>
        </div>

        <div className="artist-page-topbar-right">
          <div
            className="artist-page-topbar-right shuffle"
            onClick={handleShuffle}
          >
            <Icon name="shuffle" mode={null} size={24} folder='/images/PlaylistsPage/' />
          </div>
          <div
            className="artist-page-topbar-right play_all"
            onClick={handlePlayAll}
          >
            <Icon name="play_all" mode={null} size={16} folder='/images/PlaylistsPage/' />
          </div>
        </div>
      </div>
      <div style={{ marginBottom: isMiniPlayerVisible ? 'calc(24px + .8rem + 20px + .5rem)' : 0 }}>
        {trackIds.map(id => (
          <MusicItem key={id} trackId={id} onPlay={handlePlay} />
        ))}
      </div>
    </div>
  )
}
