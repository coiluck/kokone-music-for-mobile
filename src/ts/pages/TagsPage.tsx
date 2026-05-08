import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { usePlayerStore } from '../lib/playerStore'
import { taglist, getTagslists, addTagslists, deleteTagsLists, renameTagsLists } from '../lib/db'
import { showMessage } from '../components/Message'
import TagsItem from '../components/TagsItem'
import { Icon } from '../components/Icon'
import { useMappedTranslations } from '../lib/i18n'
import '../../css/pages/TagsPage.css'

export default function TagsPage() {
  const navigate = useNavigate()
  const [isAdding, setIsAdding] = useState(false)
  const [tagList, setTagList] = useState<taglist[]>([])
  const isPlaying = usePlayerStore(s => s.currentTrack)
  const inputRef = useRef<HTMLInputElement>(null)

  const t = useMappedTranslations({
    count: 'tags.page.count',
    placeholder: 'tags.page.add.placeholder',
    add: 'tags.page.add.button',
    nameExists: 'message.error.tag.name-exists',
    nameNull: 'message.error.tag.name-null',
  })

  useEffect(() => {
    getTagslists().then(data => {
      const sorted = data.sort((a, b) => a.name.localeCompare(b.name, 'ja'))
      setTagList(sorted)
    })
  }, [])

  const handleAdd = async() => {
    const name = inputRef.current?.value.trim()
    // check
    if (!name) {
      showMessage(t.nameNull);
      return
    } else if (tagList.some(tl => tl.name === name)) {
      showMessage(t.nameExists);
      return
    }
    
    const created = await addTagslists(name)
    setTagList(prev => {
      const next = [...prev, created]
      return next.sort((a, b) => a.name.localeCompare(b.name, 'ja'))
    })
    if (inputRef.current) inputRef.current.value = ''
    setIsAdding(false);
  }

  const handleDelete = async (id: number) => {
    await deleteTagsLists(id)
    setTagList(prev => prev.filter(tl => tl.id !== id))
  }

  const handleRename = async (id: number, name: string) => {
    // check
    if (!name) {
      showMessage(t.nameNull);
      return
    } else if (tagList.some(tl => tl.name === name)) {
      showMessage(t.nameExists);
      return
    }

    await renameTagsLists(id, name)
    setTagList(prev => {
      const next = prev.map(tl => tl.id === id ? { ...tl, name } : tl)
      return next.sort((a, b) => a.name.localeCompare(b.name, 'ja'))
    })
  }

  return (
    <div className="page fade-in">
      {isAdding && (
        <div className="tags-overlay" onClick={() => setIsAdding(false)} />
      )}

      <div className="tags-header">
        <span className="tags-header-title">{tagList.length} {t.count}</span>
        <span className="tags-header-icon-container" onClick={() => { setIsAdding(true); inputRef.current?.focus() }}>
          <Icon name="plus" mode={null} size={16} folder='/images/PlaylistsPage/' />
        </span>
      </div>

      <div
        className={`tags-add-container${isAdding ? ' is-open' : ''}`}
      >
        <input
          ref={inputRef}
          type="text"
          placeholder={t.placeholder}
          onKeyDown={e => { if (e.key === 'Enter') void handleAdd() }}
        />
        <span onClick={() => void handleAdd()}>{t.add}</span>
      </div>

      <div className="tags-main-container" style={{ paddingBottom: isPlaying ? 'calc(24px + .8rem + 20px + .5rem)' : 0 }}> {/* MiniPlayerの高さ */}
        {tagList.map(tl => (
          <div
            key={tl.id}
            onClick={() => navigate(`/tags/${encodeURIComponent(tl.name)}`)}
          >
            <TagsItem
              tagsList={tl}
              onDelete={handleDelete}
              onRename={handleRename}
            />
          </div>
        ))}
      </div>

    </div>
  )
}