import { useState, useEffect, useCallback, useMemo } from 'react'
import { useParams } from 'react-router-dom'
import { getAllTracks } from '../lib/db'
import { useTrackStore, sortByTitle } from '../lib/trackStore'
import { playFromList, playAll, shufflePlay } from '../lib/trackActions'
import { useSettingsStore } from '../lib/settingsStore'
import { usePlayerStore } from '../lib/playerStore'
import { useMappedTranslations } from '../lib/i18n'
import { Icon } from '../components/Icon'
import { formatTime } from '../components/MiniPlayer'
import MusicItem from '../components/MusicItem'
import '../../css/pages/ArtistsDetailsPage.css'

export default function ArtistsDetailsPage() {
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
    (trackId: number) => playFromList(trackIds, trackId),
    [trackIds]
  )

  const handleShuffle = useCallback(() => shufflePlay(trackIds), [trackIds])

  const handlePlayAll = useCallback(() => playAll(trackIds), [trackIds])

  return (
    <div className="page fade-in" style={{ paddingBottom: 0 }}>
      <div className="artist-details-page-topbar">
        <div className="artist-details-page-topbar-left">
          <div className="artist-details-page-topbar-icon-container">
            <Icon name="artist" mode={iconStyle} size={24} folder="/images/ArtistPage/" />
          </div>
          <div className="artist-details-page-topbar-text">
            <p className="artist-details-page-topbar-text-title">{artistName}</p>
            <p className="artist-details-page-topbar-text-meta">{trackIds.length} {t.tracksNumber}・{formatTime(totalDurationMs)}</p>
          </div>
        </div>

        <div className="artist-details-page-topbar-right">
          <div
            className="artist-details-page-topbar-right shuffle"
            onClick={handleShuffle}
          >
            <Icon name="shuffle" mode={null} size={24} folder='/images/PlaylistsPage/' />
          </div>
          <div
            className="artist-details-page-topbar-right play_all"
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
