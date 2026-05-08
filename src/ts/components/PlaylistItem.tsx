import { useRef, useState } from "react"
import { Playlist, getPlaylistTracks } from "../lib/db"
import { musicPlayer } from "../lib/music"
import { Icon } from "./Icon"
import { ListIcon } from "./ListIcon"
import ItemActionsMenu, { type ActionMenuItem } from "./ItemActionsMenu"
import EditInfoModal from "./EditInfoModal"
import { useMappedTranslations } from "../lib/i18n"
import '../../css/components/PlaylistItem.css'
import { showMessage } from "./Message"

interface Props {
  playlist: Playlist
  onDelete: (id: number) => void
  onRename: (id: number, name: string) => void
}

export default function PlaylistItem({ playlist, onDelete, onRename }: Props) {
  const icon = playlist.icon

  const actionsBtnRef = useRef<HTMLDivElement>(null)
  const nameInputRef = useRef<HTMLInputElement>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)

  const t = useMappedTranslations({
    count: 'playlists.item.count',
    addToQueue: 'playlist.item.add-to-queue',
    playNext: 'playlist.item.play-next',
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
    const tracks = await getPlaylistTracks(playlist.trackIds)
    return tracks.sort((a, b) => a.title.localeCompare(b.title, 'ja'))
  }

  const handleSave = () => {
    const name = nameInputRef.current?.value.trim()
    if (!name) return
    if (name !== playlist.name) {
      onRename(playlist.id, name)
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
      key: 'play-next',
      label: t.playNext,
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
      onClick: () => onDelete(playlist.id),
    },
  ]

  return (
    <div className="pli-component-container" >
      <div className="pli-component-icon-container">
        <div className="pli-component-icon-jacket">
          <ListIcon icon={icon} name={playlist.name} size={64} />
        </div>
        <div className="pli-component-icon-cd"></div>
      </div>
      <div className="pli-component-text-container">
        <span className="pli-component-title">{playlist.name}</span>
        <div className="pli-component-info">
          <span className="pli-component-duration">
            {playlist.trackIds.length} {t.count}
          </span>
        </div>
      </div>
      <div
        ref={actionsBtnRef}
        className="pli-component-actions"
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
              defaultValue={playlist.name}
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