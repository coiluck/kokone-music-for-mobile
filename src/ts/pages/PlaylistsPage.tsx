import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getPlaylists, type Playlist } from '../lib/db'

const RESERVED_NAMES = ['__history__', '__recommended__']
export const DISPLAY_NAMES: Record<string, string> = {
  '__history__': '履歴',
  '__recommended__': 'おすすめ',
}

export default function PlaylistsPage() {
  const [playlists, setPlaylists] = useState<Playlist[]>([])
  const navigate = useNavigate()

  useEffect(() => {
    getPlaylists().then(setPlaylists)
  }, [])

  return (
    <div className="page fade-in">
      <div onClick={() => navigate(`/playlists/${encodeURIComponent('__history__')}`)}>history</div>
      <div onClick={() => navigate(`/playlists/${encodeURIComponent('__recommended__')}`)}>reco</div>
      {playlists.map(pl => (
        <div
          key={pl.id}
          onClick={() => navigate(`/playlists/${encodeURIComponent(pl.name)}`)}
          style={{ cursor: 'pointer', padding: '12px 16px', borderBottom: '1px solid #eee' }}
        >
          {pl.name}
        </div>
      ))}
    </div>
  )
}