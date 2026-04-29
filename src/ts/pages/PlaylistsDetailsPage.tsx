import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import { getPlaylists, getPlaylistTracks, getHistory, getRecommended, type Track } from '../lib/db'
import { musicPlayer } from '../lib/music'
import MusicItem from '../components/MusicItem'
import { DISPLAY_NAMES } from './PlaylistsPage'

export default function PlaylistsDetailsPage() {
  const { name } = useParams<{ name: string }>()
  const playlistName = name ? decodeURIComponent(name) : ''

  const [tracks, setTracks] = useState<Track[]>([])

  useEffect(() => {
    if (playlistName === '__history__') {
      // historyテーブルから取得
      getHistory().then(setTracks)
    } else if (playlistName === '__recommended__') {
      // recommended用のロジック
      getRecommended().then(setTracks)
    } else {
      // 通常のplaylist
      getPlaylists().then(playlists => {
        const pl = playlists.find(p => p.name === playlistName)
        if (!pl) return
        getPlaylistTracks(pl.trackIds).then(setTracks)
      })
    }
  }, [playlistName])

  const displayName = DISPLAY_NAMES[playlistName] ?? playlistName

  const handlePlay = useCallback((track: Track) => {
    const i = tracks.findIndex(t => t.id === track.id)
    const queue = i === -1 ? [] : [...tracks.slice(i + 1), ...tracks.slice(0, i)]
    musicPlayer.setQueue(queue)
    void musicPlayer.play(track)
  }, [tracks])

  return (
    <div className="page fade-in">
      <p style={{ padding: '12px 16px' }}>{displayName}</p>
      {tracks.map(track => (
        <MusicItem key={track.id} track={track} onPlay={handlePlay} />
      ))}
    </div>
  )
}