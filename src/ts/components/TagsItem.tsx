import { useRef, useState } from "react"
import { taglist, getTagListTracks } from "../lib/db"
import { musicPlayer } from "../lib/music"
import { Icon } from "./Icon"
import { ListIcon } from "./ListIcon"
import ItemActionsMenu, { type ActionMenuItem } from "./ItemActionsMenu"
import EditInfoModal from "./EditInfoModal"
import { useMappedTranslations } from "../lib/i18n"
import '../../css/components/TagsItem.css'
import { showMessage } from "./Message"

interface Props {
  tagsList: taglist
  onDelete: (id: number) => void
  onRename: (id: number, name: string) => void
}

export default function TagsItem({ tagsList, onDelete, onRename }: Props) {
  const icon = tagsList.icon
  const sortedTags = [...tagsList.positive_tags].sort((a, b) => a.localeCompare(b, 'ja'))

  const actionsBtnRef = useRef<HTMLDivElement>(null)
  const nameInputRef = useRef<HTMLInputElement>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)

  const t = useMappedTranslations({
    addToQueue: 'playlist.item.add-to-queue',
    overwrite: 'playlist.item.play-next',
    editInfo: 'playlist.item.edit-info',
    delete: 'playlist.item.delete',
    editInfoTitle: 'playlist.item.edit-info.title',
    editInfoName: 'playlist.item.edit-info.name',
    editInfoCancel: 'playlist.item.edit-info.cancel',
    editInfoSave: 'playlist.item.edit-info.save',
    addToQueueError: 'message.error.addToQueue',
    overwriteQueueError: 'message.error.overwriteQueue',
  })

  const fetchSortedTracks = async () => {
    const tracks = await getTagListTracks(tagsList.positive_tags, tagsList.negative_tags)
    return tracks.sort((a, b) => a.title.localeCompare(b.title, 'ja'))
  }

  const handleSave = () => {
    const name = nameInputRef.current?.value.trim()
    if (!name) return
    if (name !== tagsList.name) {
      onRename(tagsList.id, name)
    }
    setEditOpen(false)
  }

  const menuItems: ActionMenuItem[] = [
    {
      key: 'add-to-queue',
      label: t.addToQueue,
      onClick: async () => {
        try {
          const tracks = await fetchSortedTracks()
          for (const track of tracks) {
            musicPlayer.enqueue(track)
          }
        } catch (e) {
          showMessage(t.addToQueueError)
        }
      },
    },
    {
      key: 'overwrite',
      label: t.overwrite,
      onClick: async () => {
        try {
          const tracks = await fetchSortedTracks()
          musicPlayer.setQueue(tracks)
        } catch (e) {
          showMessage(t.overwriteQueueError)
        }
      },
    },
    {
      key: 'edit-info',
      label: t.editInfo,
      separatorBefore: true,
      onClick: () => setEditOpen(true),
    },
    {
      key: 'delete',
      label: t.delete,
      danger: true,
      onClick: () => onDelete(tagsList.id),
    },
  ]

  return (
    <div className="ti-component-container" >
      <div className="ti-component-icon-container">
        <div className="ti-component-icon-jacket">
          <ListIcon icon={icon} name={tagsList.name} size={64} />
        </div>
        <div className="ti-component-icon-cd"></div>
      </div>
      <div className="ti-component-text-container">
        <span className="ti-component-title">{tagsList.name}</span>
        <div className="ti-component-info">
          {sortedTags.map(tag => (
            <span key={tag} className="mi-component-tag-item">
              {tag}
            </span>
          ))}
        </div>
      </div>
      <div
        ref={actionsBtnRef}
        className="ti-component-actions"
        onClick={e => {
          e.stopPropagation()
          setMenuOpen(o => !o)
        }}
      >
        <Icon name="ellipsis" mode={null} folder="/images/MusicItem/" />
      </div>

      {menuOpen && (
        <ItemActionsMenu
          anchorEl={actionsBtnRef.current}
          items={menuItems}
          onClose={() => setMenuOpen(false)}
        />
      )}

      {editOpen && (
        <EditInfoModal
          title={t.editInfoTitle}
          onClose={() => setEditOpen(false)}
        >
          <div className="ei-component-field">
            <label className="ei-component-field-label">{t.editInfoName}</label>
            <input
              ref={nameInputRef}
              className="ei-component-field-input"
              type="text"
              defaultValue={tagsList.name}
              onClick={e => e.stopPropagation()}
              onKeyDown={e => { if (e.key === 'Enter') handleSave() }}
            />
          </div>
          <div className="ei-component-footer">
            <button
              className="ei-component-button"
              onClick={e => { e.stopPropagation(); setEditOpen(false) }}
            >
              {t.editInfoCancel}
            </button>
            <button
              className="ei-component-button primary"
              onClick={e => {
                e.stopPropagation()
                handleSave()
              }}
            >
              {t.editInfoSave}
            </button>
          </div>
        </EditInfoModal>
      )}
    </div>
  )
}