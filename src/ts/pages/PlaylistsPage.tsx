import { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { getPlaylists, addPlaylist, deletePlaylist, renamePlaylist, type Playlist } from '../lib/db'
import { Icon } from '../components/Icon'
import { useSettingsStore } from '../lib/settingsStore'
import { useMappedTranslations } from '../lib/i18n'
import PlaylistItem from '../components/PlaylistItem'
import '../../css/pages/PlaylistsPage.css'

const RESERVED_NAMES = ['__history__', '__recommended__'];

export const DISPLAY_NAMES: Record<string, { ja: string, en: string }> = {
  __history__: { ja: '履歴', en: 'History' },
  __recommended__: { ja: 'おすすめ', en: 'Recommended' },
}

export default function PlaylistsPage() {
  const t = useMappedTranslations({
    count: 'playlists.page.count',
    placeholder: 'playlists.page.add.placeholder',
    add: 'playlists.page.add.button',
  })
  const lang = useSettingsStore(s => s.lang)
  const [playlists, setPlaylists] = useState<Playlist[]>([])
  const [isAdding, setIsAdding] = useState(false)
  const navigate = useNavigate()
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    getPlaylists().then(data => {
      const sorted = data.sort((a, b) => a.name.localeCompare(b.name, 'ja'))
      setPlaylists(sorted)
    })
  }, [])

  const handleAdd = async () => {
    const name = inputRef.current?.value.trim()
    if (!name) return
    if (playlists.some(pl => pl.name === name)) return
    if (RESERVED_NAMES.includes(name)) return

    const created = await addPlaylist(name)
    setPlaylists(prev => {
      const next = [...prev, created]
      return next.sort((a, b) => a.name.localeCompare(b.name, 'ja'))
    })
    if (inputRef.current) inputRef.current.value = ''
    setIsAdding(false)
  }

  const handleDelete = async (id: number) => {
    await deletePlaylist(id)
    setPlaylists(prev => prev.filter(pl => pl.id !== id))
  }

  const handleRename = async (id: number, name: string) => {
    if (RESERVED_NAMES.includes(name)) {
      console.log('[PlaylistsPage] rename rejected: reserved name:', name)
      return
    }
    if (playlists.some(pl => pl.id !== id && pl.name === name)) {
      console.log('[PlaylistsPage] rename rejected: name already exists:', name)
      return
    }
    await renamePlaylist(id, name)
    setPlaylists(prev => {
      const next = prev.map(pl => pl.id === id ? { ...pl, name } : pl)
      return next.sort((a, b) => a.name.localeCompare(b.name, 'ja'))
    })
  }

  return (
    <div className="page fade-in">
      {isAdding && (
        <div className="playlists-page-overlay" onClick={() => setIsAdding(false)} />
      )}

      <div className="playlists-page-default-list-container">
        <div
          className="playlists-page-default-list-item"
          onClick={() => navigate(`/playlists/${encodeURIComponent('__history__')}`)}
        >
          {DISPLAY_NAMES['__history__'][lang]}
        </div>
        <div className="playlists-page-default-list-item" onClick={() => navigate(`/playlists/${encodeURIComponent('__recommended__')}`)}>
          {DISPLAY_NAMES['__recommended__'][lang]}
        </div>
      </div>

      <div className="playlists-page-user-list">
        <div className="playlists-page-user-list-header">
          <span className="playlists-page-user-list-header-title">{playlists.length} {t.count}</span>
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
        <div className="playlists-page-user-list-container">
          {playlists.map(pl => (
            <div
              key={pl.id}
              onClick={() => navigate(`/playlists/${encodeURIComponent(pl.name)}`)}
            >
              <PlaylistItem
                playlist={pl}
                onDelete={handleDelete}
                onRename={handleRename}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}