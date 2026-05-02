import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import { getPlaylists, getPlaylistTracks, getHistory, getRecommended, type Track } from '../lib/db'
import { musicPlayer } from '../lib/music'
import MusicItem from '../components/MusicItem'
import { DISPLAY_NAMES } from './PlaylistsPage'
import { useSettingsStore, type Lang } from '../lib/settingsStore'
import { Icon } from '../components/Icon'
import '../../css/pages/PlaylistsDetailsPage.css'

export default function PlaylistsDetailsPage() {
  const { name } = useParams<{ name: string }>()
  const playlistName = name ? decodeURIComponent(name) : ''
  const lang = useSettingsStore(s => s.lang)
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

  const playlistHeader = reserved ? (
    <div className="playlists-details-header">
    <div className="playlists-details-button-container">
      <div className="playlists-details-header-title">{displayName}</div>
      <div className="playlists-details-button-right">
        <div className="playlists-details-button-right shuffle">
          <Icon name="shuffle" mode={null} size={20} folder='/images/PlaylistsPage/' />
        </div>
        <div className="playlists-details-button-right play_all">
          <Icon name="play_all" mode={null} size={20} folder='/images/PlaylistsPage/' />
        </div>
      </div>
    </div>
  </div>
  ) : (
    <div className="playlists-details-header">
      <div className="playlists-details-header-title">{displayName}</div>
      <div className="playlists-details-header-icon-container">
        <Icon name="playlist" mode={iconStyle} size={128} folder='/images/PlaylistsPage/' />
      </div>
      <div className="playlists-details-button-container">
        <div className="playlists-details-button-left">
          <Icon name="plus" mode={null} size={16} folder='/images/PlaylistsPage/' />
        </div>
        <div className="playlists-details-button-right">
          <div className="playlists-details-button-right shuffle">
            <Icon name="shuffle" mode={null} size={24} folder='/images/PlaylistsPage/' />
          </div>
          <div className="playlists-details-button-right play_all">
            <Icon name="play_all" mode={null} size={20} folder='/images/PlaylistsPage/' />
          </div>
        </div>
      </div>
    </div>
  )

  return (
    <div className="page fade-in">
      {playlistHeader}
      {tracks.map(track => (
        <MusicItem key={track.id} track={track} onPlay={handlePlay} />
      ))}
    </div>
  )
}