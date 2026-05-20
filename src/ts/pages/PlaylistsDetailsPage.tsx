import { useEffect, useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { getPlaylists, getPlaylistTracks, getHistory, getRecommended, type Track } from '../lib/db'
import { useTrackStore } from '../lib/trackStore'
import { musicPlayer } from '../lib/music'
import MusicItem from '../components/MusicItem'
import { DISPLAY_NAMES } from './PlaylistsPage'
import { useSettingsStore, type Lang } from '../lib/settingsStore'
import { ListIcon } from '../components/ListIcon'
import type { PlaylistIcon as PlaylistIconData } from '../lib/playlistIcon'
import { Icon } from '../components/Icon'
import '../../css/pages/PlaylistsDetailsPage.css'
import { usePlayerStore } from '../lib/playerStore'

function sortByTitle(tracks: Track[]): Track[] {
  return [...tracks].sort((a, b) =>
    (a.title ?? '').localeCompare(b.title ?? '', 'ja', { sensitivity: 'variant', numeric: true })
  )
}

export default function PlaylistsDetailsPage() {
  const { name } = useParams<{ name: string }>()
  const playlistName = name ? decodeURIComponent(name) : ''
  const lang = useSettingsStore(s => s.lang)
  const [icon, setIcon] = useState<PlaylistIconData | null>(null)
  const navigate = useNavigate()
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
    (trackId: number) => {
      const byId = useTrackStore.getState().tracksById
      const track = byId[trackId]
      if (!track) return

      const i = trackIds.indexOf(trackId)
      const queueIds = i === -1 ? [] : [...trackIds.slice(i + 1), ...trackIds.slice(0, i)]
      const queue = queueIds.map(id => byId[id]).filter((t): t is Track => Boolean(t))
      musicPlayer.setQueue(queue)
      void musicPlayer.play(track)
    },
    [trackIds]
  )

  const handlePlayAll = useCallback(() => {
    if (trackIds.length === 0) return
    const byId = useTrackStore.getState().tracksById
    const tracks = trackIds.map(id => byId[id]).filter((t): t is Track => Boolean(t))
    if (tracks.length === 0) return
    const [first, ...rest] = tracks
    musicPlayer.setQueue(rest)
    void musicPlayer.play(first)
  }, [trackIds])

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
            onClick={() => navigate(`/icon-edit/playlist/${encodeURIComponent(playlistName)}`)}
          >
            <ListIcon icon={icon} name={playlistName} size={192} />
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