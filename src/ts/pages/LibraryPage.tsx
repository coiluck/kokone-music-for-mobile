import { useEffect, useState, useCallback } from 'react'
import { getAllTracks, type Track } from '../lib/db'
import { useScanStore } from '../lib/scanStore'
import { musicPlayer } from '../lib/music'
import MusicItem from '../components/MusicItem'

export default function LibraryPage() {
  const [tracks, setTracks] = useState<Track[]>([])
  const [loading, setLoading] = useState(true)
  const scanVersion = useScanStore(s => s.scanVersion)

  const load = useCallback(async () => {
    setLoading(true)
    const result = await getAllTracks()
    setTracks(result)
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
  }, [scanVersion, load])

  const handlePlay = useCallback(
    (track: Track) => {
      const i = tracks.findIndex(t => t.id === track.id)
      if (i === -1) {
        void musicPlayer.play(track)
        return
      }
      musicPlayer.setQueue(tracks.slice(i + 1))
      void musicPlayer.play(track)
    },
    [tracks]
  )

  return (
    <div className="page fade-in">
      <div className="library-toolbar">
        <span className="library-count">{tracks.length} 曲</span>
      </div>

      {loading ? (
        <p className="library-empty">読み込み中...</p>
      ) : tracks.length === 0 ? (
        <p className="library-empty">
          まだ曲がありません。設定からフォルダを追加してください。
        </p>
      ) : (
        <div className="music-list">
          {tracks.map(track => (
            <MusicItem
              key={track.id}
              track={track}
              onPlay={handlePlay}
            />
          ))}
        </div>
      )}
    </div>
  )
}