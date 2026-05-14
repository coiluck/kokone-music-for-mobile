import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import { getAlbumTracks, type Track } from '../lib/db'
import MusicItem from '../components/MusicItem'
import { useMappedTranslations } from '../lib/i18n'
import { usePlayerStore } from '../lib/playerStore'
import { musicPlayer } from '../lib/music'
import { Icon } from '../components/Icon'
import { formatTime } from '../components/MiniPlayer'
import { useSettingsStore } from '../lib/settingsStore'
import '../../css/pages/AlbumDetailsPage.css'

export default function AlbumDetailsPage() {
  const { name } = useParams<{ name: string }>()
  const albumName = name ? decodeURIComponent(name) : ''

  const [tracks, setTracks] = useState<Track[]>([])
  const t = useMappedTranslations({
    tracksNumber: 'album.details.tracksNumber',
  })

  const iconStyle = useSettingsStore(s => s.iconStyle)
  const isMiniPlayerVisible = usePlayerStore(s => s.currentTrack)

  useEffect(() => {
    getAlbumTracks(albumName).then(tracks => {
      tracks.sort((a, b) =>
        (a.title ?? '').localeCompare(b.title ?? '', 'ja', {
          sensitivity: 'variant',
          numeric: true,
        })
      )
      setTracks(tracks)
    })
  }, [albumName])

  const totalDurationMs = tracks.reduce((sum, t) => sum + (t.duration_ms ?? 0), 0)

  const handlePlay = useCallback(
    (track: Track) => {
      const i = tracks.findIndex(t => t.id === track.id)
      if (i === -1) {
        void musicPlayer.play(track)
        return
      }
      const queue = [...tracks.slice(i + 1), ...tracks.slice(0, i)]
      musicPlayer.setQueue(queue)
      void musicPlayer.play(track)
    },
    [tracks]
  )

  const handleShuffle = useCallback(() => {
    if (tracks.length === 0) return
    // Fisher-Yates
    const shuffled = [...tracks]
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
    }
    const [first, ...rest] = shuffled
    musicPlayer.setQueue(rest)
    void musicPlayer.play(first)
  }, [tracks])

  const handlePlayAll = useCallback(() => {
    if (tracks.length === 0) return
    const [first, ...rest] = tracks
    musicPlayer.setQueue(rest)
    void musicPlayer.play(first)
  }, [tracks])

  return (
    <div className="page fade-in" style={{ paddingBottom: 0 }}>
      <div className="album-details-page-topbar">
        <div className="album-details-page-topbar-left">
          <div className="album-details-page-topbar-icon-container">
            <Icon name="artist" mode={iconStyle} size={24} folder="/images/ArtistPage/" />
          </div>
          <div className="album-details-page-topbar-text">
            <p className="album-details-page-topbar-text-title">{albumName}</p>
            <p className="album-details-page-topbar-text-meta">{tracks.length} {t.tracksNumber}・{formatTime(totalDurationMs)}</p>
          </div>
        </div>

        <div className="album-details-page-topbar-right">
          <div
            className="album-details-page-topbar-right shuffle"
            onClick={handleShuffle}
          >
            <Icon name="shuffle" mode={null} size={24} folder='/images/PlaylistsPage/' />
          </div>
          <div
            className="album-details-page-topbar-right play_all"
            onClick={handlePlayAll}
          >
            <Icon name="play_all" mode={null} size={16} folder='/images/PlaylistsPage/' />
          </div>
        </div>
      </div>
      <div style={{ marginBottom: isMiniPlayerVisible ? 'calc(24px + .8rem + 20px + .5rem)' : 0 }}>
        {tracks.map(track => (
          <MusicItem key={track.id} track={track} onPlay={handlePlay} />
        ))}
      </div>
    </div>
  )
}