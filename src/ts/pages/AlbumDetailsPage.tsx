import { useState, useEffect, useCallback, useMemo } from 'react'
import { useParams } from 'react-router-dom'
import { getAlbumTracks } from '../lib/db'
import { useTrackStore, sortByTitle } from '../lib/trackStore'
import { playFromList, playAll, shufflePlay } from '../lib/trackActions'
import MusicItem from '../components/MusicItem'
import { useMappedTranslations } from '../lib/i18n'
import { usePlayerStore } from '../lib/playerStore'
import { Icon } from '../components/Icon'
import { formatTime } from '../components/MiniPlayer'
import { useSettingsStore } from '../lib/settingsStore'
import '../../css/pages/AlbumDetailsPage.css'

export default function AlbumDetailsPage() {
  const { name } = useParams<{ name: string }>()
  const albumName = name ? decodeURIComponent(name) : ''

  const [trackIds, setTrackIds] = useState<number[]>([])
  const tracksById = useTrackStore(s => s.tracksById)

  const t = useMappedTranslations({
    tracksNumber: 'album.details.tracksNumber',
  })

  const iconStyle = useSettingsStore(s => s.iconStyle)
  const isMiniPlayerVisible = usePlayerStore(s => s.currentTrack)

  useEffect(() => {
    getAlbumTracks(albumName).then(fetched => {
      const sorted = sortByTitle(fetched)
      setTrackIds(sorted.map(t => t.id))
    })
  }, [albumName])

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
      <div className="album-details-page-topbar">
        <div className="album-details-page-topbar-left">
          <div className="album-details-page-topbar-icon-container">
            <Icon name="artist" mode={iconStyle} size={24} folder="/images/ArtistPage/" />
          </div>
          <div className="album-details-page-topbar-text">
            <p className="album-details-page-topbar-text-title">{albumName}</p>
            <p className="album-details-page-topbar-text-meta">{trackIds.length} {t.tracksNumber}・{formatTime(totalDurationMs)}</p>
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
        {trackIds.map(id => (
          <MusicItem key={id} trackId={id} onPlay={handlePlay} />
        ))}
      </div>
    </div>
  )
}