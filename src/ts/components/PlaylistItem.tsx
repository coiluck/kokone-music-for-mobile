import { useRef, useState } from "react"
import { Playlist } from "../lib/db"
import { Icon } from "./Icon"
import { PlaylistIcon as PlaylistIconView } from "./PlaylistIcon"
import ItemActionsMenu, { type ActionMenuItem } from "./ItemActionsMenu"
import EditInfoModal from "./EditInfoModal"
import { useMappedTranslations } from "../lib/i18n"
import '../../css/components/PlaylistItem.css'

interface Props {
  playlist: Playlist
}

export default function PlaylistItem({ playlist }: Props) {
  const icon = playlist.icon

  const actionsBtnRef = useRef<HTMLDivElement>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)

  const t = useMappedTranslations({
    addToQueue: 'playlist.item.add-to-queue',
    playNext: 'playlist.item.play-next',
    editInfo: 'playlist.item.edit-info',
    delete: 'playlist.item.delete',
    editInfoTitle: 'playlist.item.edit-info.title',
    editInfoName: 'playlist.item.edit-info.name',
    editInfoCancel: 'playlist.item.edit-info.cancel',
    editInfoSave: 'playlist.item.edit-info.save',
  })

  const menuItems: ActionMenuItem[] = [
    {
      key: 'add-to-queue',
      label: t.addToQueue,
      onClick: () => console.log('[PlaylistItem] add to queue:', playlist),
    },
    {
      key: 'play-next',
      label: t.playNext,
      onClick: () => console.log('[PlaylistItem] overwrite queue:', playlist),
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
      onClick: () => console.log('[PlaylistItem] delete:', playlist),
    },
  ]

  return (
    <div className="pli-component-container" >
      <div className="pli-component-icon-container">
        <div className="pli-component-icon-jacket">
          <PlaylistIconView icon={icon} name={playlist.name} size={64} />
        </div>
        <div className="pli-component-icon-cd"></div>
      </div>
      <div className="pli-component-text-container">
        <span className="pli-component-title">{playlist.name}</span>
        <div className="pli-component-info">
          {playlist.trackIds.length == 0 && (
            <span className="pli-component-duration">
              0:00
            </span>
          )}
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
              className="ei-component-field-input"
              type="text"
              defaultValue={playlist.name}
              onClick={e => e.stopPropagation()}
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
                console.log('[PlaylistItem] save edit (TODO):', playlist)
                setEditOpen(false)
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