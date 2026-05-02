import { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { getPlaylists, addPlaylist, type Playlist } from '../lib/db'
import { Icon } from '../components/Icon'
import { useMappedTranslations } from '../lib/i18n'
import '../../css/pages/PlaylistsPage.css'

const RESERVED_NAMES = ['__history__', '__recommended__'];

export const DISPLAY_NAMES: Record<string, { ja: string, en: string }> = {
  __history__: { ja: '履歴', en: 'History' },
  __recommended__: { ja: 'おすすめ', en: 'Recommended' },
}

export default function PlaylistsPage() {
  const t = useMappedTranslations({
    placeholder: 'playlists.page.add.placeholder',
    add: 'playlists.page.add.button',
  })
  const [playlists, setPlaylists] = useState<Playlist[]>([])
  const [isAdding, setIsAdding] = useState(false)
  const navigate = useNavigate()
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    getPlaylists().then(setPlaylists)
  }, [])

  const handleAdd = async () => {
    const name = inputRef.current?.value.trim()
    if (!name) return
    if (playlists.some(pl => pl.name === name)) return
    if (RESERVED_NAMES.includes(name)) return

    const created = await addPlaylist(name)
    setPlaylists(prev => [created, ...prev])
    if (inputRef.current) inputRef.current.value = ''
    setIsAdding(false)
  }

  return (
    <div className="page fade-in">
      {isAdding && (
        <div className="playlists-page-overlay" onClick={() => setIsAdding(false)} />
      )}

      <div onClick={() => navigate(`/playlists/${encodeURIComponent('__history__')}`)}>history</div>
      <div onClick={() => navigate(`/playlists/${encodeURIComponent('__recommended__')}`)}>reco</div>

      <div className="playlists-page-user-list">
        <div className="playlists-page-user-list-header">
          <span className="playlists-page-user-list-header-title">{playlists.length} playlists</span>
          <span className="playlists-page-user-list-header-icon-container" onClick={() => { setIsAdding(true); inputRef.current?.focus() }}>
            <Icon name="plus" mode={null} size={16} folder='/images/PlaylistsPage/' />
          </span>
        </div>

        <div
          className={`playlists-page-user-list-add-container${isAdding ? ' is-open' : ''}`}
        >
          <input
            ref={inputRef}
            type="text"
            placeholder={t.placeholder}
            onKeyDown={e => { if (e.key === 'Enter') void handleAdd() }}
          />
          <span onClick={() => void handleAdd()}>{t.add}</span>
        </div>
        {playlists.map(pl => (
          <div
            key={pl.id}
            onClick={() => navigate(`/playlists/${encodeURIComponent(pl.name)}`)}
            style={{ cursor: 'pointer', padding: '12px 16px', border: '1px solid #eee' }}
            >
            {pl.name}
          </div>
        ))}
      </div>
    </div>
  )
}