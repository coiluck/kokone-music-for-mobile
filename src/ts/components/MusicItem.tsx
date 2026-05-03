import { useRef, useState } from "react"
import { Track } from "../lib/db"
import { usePlayerStore } from "../lib/playerStore"
import { useSettingsStore } from '../lib/settingsStore'
import { formatTime } from "../components/MiniPlayer"
import { Icon } from "./Icon"
import ItemActionsMenu, { type ActionMenuItem } from "./ItemActionsMenu"
import EditInfoModal from "./EditInfoModal"
import { useMappedTranslations } from "../lib/i18n"
import '../../css/components/MusicItem.css'

interface Props {
  track: Track
  onPlay: (track: Track) => void
  onRemove?: () => void
}

export default function MusicItem({ track, onPlay, onRemove }: Props) {
  const iconStyle = useSettingsStore(s => s.iconStyle)

  const isItemPlaying = usePlayerStore(s => s.currentTrack?.id === track.id)
  const isItemPausing = usePlayerStore(s => s.currentTrack?.id === track.id && !s.isPlaying)

  const actionsBtnRef = useRef<HTMLDivElement>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)

  const t = useMappedTranslations({
    editInfoTitle: 'music.item.edit-info.title',
    editInfoName: 'music.item.edit-info.name',
    editInfoArtist: 'music.item.edit-info.artist',
    editInfoTags: 'music.item.edit-info.tags',
    editInfoTagsPlaceholder: 'music.item.edit-info.tags.placeholder',
    editInfoAlbum: 'music.item.edit-info.album',
    editInfoCancel: 'music.item.edit-info.cancel',
    editInfoSave: 'music.item.edit-info.save',
    addToQueue: 'music.item.actions.add-to-queue',
    playNext: 'music.item.actions.play-next',
    addToPlaylist: 'music.item.actions.add-to-playlist',
  })

  const menuItems: ActionMenuItem[] = [
    {
      key: 'add-to-queue',
      label: t.addToQueue,
      onClick: () => console.log('[MusicItem] add to queue:', track),
    },
    {
      key: 'play-next',
      label: t.playNext,
      onClick: () => console.log('[MusicItem] play next:', track),
    },
    {
      key: 'add-to-playlist',
      label: t.addToPlaylist,
      onClick: () => console.log('[MusicItem] add to playlist:', track),
    },
    {
      key: 'edit-info',
      label: t.editInfoTitle,
      separatorBefore: true,
      onClick: () => setEditOpen(true),
    },
  ]

  return (
    <div
      className="mi-component-container"
      onClick={() => { if (!isItemPlaying) onPlay(track); }}
    >
      <div className={`mi-component-icon-container ${isItemPlaying ? 'playing' : ''}`}>
        {isItemPlaying ? (
          <div className={`mi-component-icon-container-playing ${isItemPausing ? 'paused' : ''}`} >
            <span></span>
            <span></span>
            <span></span>
            <span></span>
            <span></span>
          </div>
        ) : (
          <Icon name="music" mode={iconStyle} size={24} folder='/images/MiniPlayer/' />
        )}
      </div>
      <div className="mi-component-text-container">
        <span className={`mi-component-title ${isItemPlaying ? 'playing' : ''}`}>{track.title}</span>
        <div className="mi-component-info">
          <div className="mi-component-info-left">
            <span className="mi-component-artist">{track.artist}</span>
            {track.duration_ms != null && (
              <>
                <span className="mi-component-separator">・</span>
                <span className="mi-component-duration">
                  {formatTime(track.duration_ms)}
                </span>
              </>
            )}
          </div>
          {track.tags.length > 0 && (
            <div className="mi-component-tag-container">
              {track.tags.map(tag => (
                <span key={tag} className="mi-component-tag-item">
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="mi-component-actions-container">
        {onRemove && (
          <div
            className="mi-component-actions"
            onClick={e => { e.stopPropagation(); onRemove(); }}
          >
            <Icon name="remove" mode={iconStyle} folder="/images/MusicItem/" />
          </div>
        )}
        <div
          ref={actionsBtnRef}
          className="mi-component-actions"
          onClick={e => {
            e.stopPropagation()
            setMenuOpen(o => !o)
          }}
         >
          <Icon name="ellipsis" mode={null} folder="/images/MusicItem/" />
        </div>
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
              defaultValue={track.title}
              onClick={e => e.stopPropagation()}
            />
          </div>
          <div className="ei-component-field">
            <label className="ei-component-field-label">{t.editInfoArtist}</label>
            <input
              className="ei-component-field-input"
              type="text"
              defaultValue={track.artist ?? ''}
              onClick={e => e.stopPropagation()}
            />
          </div>
          <div className="ei-component-field">
            <label className="ei-component-field-label">{t.editInfoTags}</label>
            <input
              className="ei-component-field-input"
              type="text"
              placeholder={t.editInfoTagsPlaceholder}
              defaultValue={track.tags.join(', ')}
              onClick={e => e.stopPropagation()}
            />
          </div>
          <div className="ei-component-footer">
            <button
              type="button"
              className="ei-component-button"
              onClick={e => { e.stopPropagation(); setEditOpen(false) }}
            >
              {t.editInfoCancel}
            </button>
            <button
              type="button"
              className="ei-component-button primary"
              onClick={e => {
                e.stopPropagation()
                console.log('[MusicItem] save edit (TODO):', track)
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