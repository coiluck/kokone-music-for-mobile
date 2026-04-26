import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import { getAllTracks, type Track } from '../lib/db'
import { useScanStore } from '../lib/scanStore'
import { musicPlayer } from '../lib/music'
import { useSettingsStore } from '../lib/settingsStore'
import { usePlayerStore } from '../lib/playerStore'
import { useMappedTranslations } from '../lib/i18n'
import { Icon } from '../components/Icon'
import { formatTime } from '../components/MiniPlayer'
import MusicItem from '../components/MusicItem'
import '../../css/pages/ArtistPage.css'

export default function ArtistPage() {
  const { name } = useParams<{ name: string }>()
  const artistName = name ? decodeURIComponent(name) : ''

  const [tracks, setTracks] = useState<Track[]>([])
  const [loading, setLoading] = useState(true)
  const scanVersion = useScanStore(s => s.scanVersion)

  const t = useMappedTranslations({
    tracksNumber: 'artist.item.tracksNumber',
  })

  const iconStyle = useSettingsStore(s => s.iconStyle)
  const isMiniPlayerVisible = usePlayerStore(s => s.currentTrack)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    getAllTracks().then(all => {
      if (cancelled) return
      const filtered = all
        .filter(t => (t.artist ?? '') === artistName)
        .sort((a, b) =>
          (a.title ?? '').localeCompare(b.title ?? '', 'ja', {
            sensitivity: 'variant',
            numeric: true,
          })
        )
      setTracks(filtered)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [artistName, scanVersion])

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

  if (loading) {
    return (
      <div className="page fade-in">
        <p>Loading...</p>
      </div>
    )
  }

  const totalDurationMs = tracks.reduce((sum, t) => sum + (t.duration_ms ?? 0), 0)

  return (
    <div className="page fade-in" style={{ paddingBottom: 0 }}>
      <div className="artist-page-topbar">
        <div className="artist-page-topbar-icon-container">
          <Icon name="artist" mode={iconStyle} size={24} folder="/images/ArtistPage/" />
        </div>
        <div className="artist-page-topbar-text">
          <p className="artist-page-topbar-text-title">{artistName}</p>
          <p className="artist-page-topbar-text-meta">{tracks.length} {t.tracksNumber}・{formatTime(totalDurationMs)}</p>
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