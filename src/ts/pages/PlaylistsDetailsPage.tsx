import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import { getPlaylists, getPlaylistTracks, getHistory, getRecommended, setPlaylistIcon } from '../lib/db'
import { sortByTitle } from '../lib/trackStore'
import { playFromList, playAll, shufflePlay } from '../lib/trackActions'
import MusicItem from '../components/MusicItem'
import { DISPLAY_NAMES } from './PlaylistsPage'
import { useSettingsStore, type Lang } from '../lib/settingsStore'
import { ListIcon } from '../components/ListIcon'
import { rollHue, type PlaylistIcon as PlaylistIconData } from '../lib/playlistIcon'
import { Icon } from '../components/Icon'
import '../../css/pages/PlaylistsDetailsPage.css'
import { usePlayerStore } from '../lib/playerStore'

export default function PlaylistsDetailsPage() {
  const { name } = useParams<{ name: string }>()
  const playlistName = name ? decodeURIComponent(name) : ''
  const lang = useSettingsStore(s => s.lang)
  const [playlistId, setPlaylistId] = useState<number | null>(null)
  const [icon, setIcon] = useState<PlaylistIconData | null>(null)
  const isPlaying = usePlayerStore(s => s.currentTrack)
  const iconStyle = useSettingsStore(s => s.iconStyle)

  const [trackIds, setTrackIds] = useState<number[]>([])

  useEffect(() => {
    if (playlistName === '__history__') {
      getHistory().then(t => {
        // history は新しい順で表示するため sort はしない
        setTrackIds(t.map(x => x.id))
      })
    } else if (playlistName === '__recommended__') {
      getRecommended().then(t => {
        // recommended のスコア順を保つため sort はしない
        setTrackIds(t.map(x => x.id))
      })
    } else {
      getPlaylists().then(playlists => {
        const pl = playlists.find(p => p.name === playlistName)
        if (!pl) return
        setPlaylistId(pl.id)
        setIcon(pl.icon)
        getPlaylistTracks(pl.trackIds).then(t => {
          const sorted = sortByTitle(t)
          setTrackIds(sorted.map(x => x.id))
        })
      })
    }
  }, [playlistName])

  const reserved = DISPLAY_NAMES[playlistName]
  const displayName = reserved ? reserved[lang as Lang] : playlistName

  const handlePlay = useCallback(
    (trackId: number) => playFromList(trackIds, trackId),
    [trackIds]
  )

  const handlePlayAll = useCallback(() => playAll(trackIds), [trackIds])

  const handleShuffle = useCallback(() => shufflePlay(trackIds), [trackIds])

  const handleRollIcon = () => {
    if (!icon || playlistId == null) return
    const next: PlaylistIconData = { kind: 'auto', hue: rollHue(icon.hue) }
    setIcon(next)
    void setPlaylistIcon(playlistId, next)
  }

  const playlistHeader = reserved ? (
    <div className="playlists-details-header">
    <div className="playlists-details-button-container">
      <div className="playlists-details-header-title">{displayName}</div>
      <div className="playlists-details-button-right">
        <div
          className="playlists-details-button-right shuffle"
          onClick={handleShuffle}
        >
          <Icon name="shuffle" mode={iconStyle} size={20} folder='/images/PlaylistsPage/' />
        </div>
        <div
          className="playlists-details-button-right play_all"
          onClick={handlePlayAll}
        >
          <Icon name="play_all" mode={null} size={20} folder='/images/PlaylistsPage/' />
        </div>
      </div>
    </div>
  </div>
  ) : (
    <div className="playlists-details-header">
      <div className="playlists-details-header-title">{displayName}</div>
      <div className="playlists-details-header-icon-container">
        <div className="playlists-details-header-cd-wrapper">
          <div
            className="playlists-details-header-cd-jacket-container"
            onClick={handleRollIcon}
          >
            {icon && <ListIcon icon={icon} name={playlistName} size={192} />}
          </div>
          <div className="playlists-details-header-cd-disc-icon" />
        </div>
      </div>
      <div className="playlists-details-button-container">
        <div className="playlists-details-button-left">
          <Icon name="plus" mode={null} size={16} folder='/images/PlaylistsPage/' />
        </div>
        <div className="playlists-details-button-right">
          <div
            className="playlists-details-button-right shuffle"
            onClick={handleShuffle}
          >
            <Icon name="shuffle" mode={null} size={24} folder='/images/PlaylistsPage/' />
          </div>
          <div
            className="playlists-details-button-right play_all"
            onClick={handlePlayAll}
          >
            <Icon name="play_all" mode={null} size={16} folder='/images/PlaylistsPage/' />
          </div>
        </div>
      </div>
    </div>
  )

  return (
    <div className="page fade-in">
      {playlistHeader}
      <div style={{ paddingBottom: isPlaying ? 'calc(24px + .8rem + 20px + .5rem)' : 0 }}> {/* MiniPlayerの高さ */}
        {trackIds.map(id => (
          <MusicItem key={id} trackId={id} onPlay={handlePlay} />
        ))}
      </div>
    </div>
  )
}