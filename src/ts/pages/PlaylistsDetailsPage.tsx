import { useEffect, useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { getPlaylists, getPlaylistTracks, getHistory, getRecommended, type Track } from '../lib/db'
import { musicPlayer } from '../lib/music'
import MusicItem from '../components/MusicItem'
import { DISPLAY_NAMES } from './PlaylistsPage'
import { useSettingsStore, type Lang } from '../lib/settingsStore'
import { ListIcon } from '../components/ListIcon'
import type { PlaylistIcon as PlaylistIconData } from '../lib/playlistIcon'
import { Icon } from '../components/Icon'
import '../../css/pages/PlaylistsDetailsPage.css'
import { usePlayerStore } from '../lib/playerStore'

export default function PlaylistsDetailsPage() {
  const { name } = useParams<{ name: string }>()
  const playlistName = name ? decodeURIComponent(name) : ''
  const lang = useSettingsStore(s => s.lang)
  const [icon, setIcon] = useState<PlaylistIconData | null>(null)
  const navigate = useNavigate()
  const isPlaying = usePlayerStore(s => s.currentTrack)
  const iconStyle = useSettingsStore(s => s.iconStyle)

  const [tracks, setTracks] = useState<Track[]>([])

  useEffect(() => {
    if (playlistName === '__history__') {
      getHistory().then(setTracks)
    } else if (playlistName === '__recommended__') {
      getRecommended().then(setTracks)
    } else {
      getPlaylists().then(playlists => {
        const pl = playlists.find(p => p.name === playlistName)
        if (!pl) return
        setIcon(pl.icon)
        getPlaylistTracks(pl.trackIds).then(setTracks)
      })
    }
  }, [playlistName])

  const reserved = DISPLAY_NAMES[playlistName]
  const displayName = reserved ? reserved[lang as Lang] : playlistName

  const handlePlay = useCallback((track: Track) => {
    const i = tracks.findIndex(t => t.id === track.id)
    const queue = i === -1 ? [] : [...tracks.slice(i + 1), ...tracks.slice(0, i)]
    musicPlayer.setQueue(queue)
    void musicPlayer.play(track)
  }, [tracks])

  const handlePlayAll = useCallback(() => {
    if (tracks.length === 0) return
    const [first, ...rest] = tracks
    musicPlayer.setQueue(rest)
    void musicPlayer.play(first)
  }, [tracks])

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
            <Icon name="play_all" mode={null} size={20} folder='/images/PlaylistsPage/' />
          </div>
        </div>
      </div>
    </div>
  )

  return (
    <div className="page fade-in">
      {playlistHeader}
      <div style={{ paddingBottom: isPlaying ? 'calc(24px + .8rem + 20px + .5rem)' : 0 }}> {/* MiniPlayerの高さ */}
        {tracks.map(track => (
          <MusicItem key={track.id} track={track} onPlay={handlePlay} />
        ))}
      </div>
    </div>
  )
}