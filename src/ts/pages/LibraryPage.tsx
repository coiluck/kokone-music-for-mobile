import { useEffect, useState, useCallback } from 'react'
import { getAllTracks, searchTracks, type Track } from '../lib/db'
import { useScanStore } from '../lib/scanStore'

function formatDuration(ms: number | null): string {
  if (ms == null) return '—'
  const totalSec = Math.floor(ms / 1000)
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

export default function LibraryPage() {
  const [tracks, setTracks] = useState<Track[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const scanVersion = useScanStore(s => s.scanVersion)

  const load = useCallback(async (q: string) => {
    setLoading(true)
    const result = q.trim() ? await searchTracks(q) : await getAllTracks()
    setTracks(result)
    setLoading(false)
  }, [])

  useEffect(() => {
    load(query)
  }, [scanVersion, query, load])

  return (
    <div className="page fade-in">
      <div className="library-toolbar">
        <input
          className="library-search"
          type="search"
          placeholder="曲名・アーティスト・アルバムで検索..."
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
        <span className="library-count">{tracks.length} 曲</span>
      </div>

      {loading ? (
        <p className="library-empty">読み込み中...</p>
      ) : tracks.length === 0 ? (
        <p className="library-empty">
          {query ? '該当する曲が見つかりませんでした' : 'まだ曲がありません。設定からフォルダを追加してください。'}
        </p>
      ) : (
        <table className="track-table">
          <thead>
            <tr>
              <th>#</th><th>曲名</th><th>アーティスト</th><th>アルバム</th><th>時間</th>
            </tr>
          </thead>
          <tbody>
            {tracks.map((track, i) => (
              <tr key={track.id} className="track-row" onDoubleClick={() => {}}>
                <td className="track-index">{i + 1}</td>
                <td className="track-title">{track.title ?? track.path.split('/').pop()}</td>
                <td className="track-artist">{track.artist ?? '—'}</td>
                <td className="track-album">{track.album ?? '—'}</td>
                <td className="track-duration">{formatDuration(track.duration_ms)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}