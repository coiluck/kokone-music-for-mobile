import { useRef, useState } from "react"
import { useNavigate } from 'react-router-dom'
import { useSettingsStore } from '../lib/settingsStore'
import { useMappedTranslations } from '../lib/i18n'
import { getAlbumTracks } from '../lib/db'
import { musicPlayer } from '../lib/music'
import { Icon } from './Icon'
import ItemActionsMenu, { type ActionMenuItem } from "./ItemActionsMenu"
import { showMessage } from "./Message"
import '../../css/components/AlbumItem.css'

interface AlbumItemProps {
  albumName: string
  albumTracksNumber: number
}

export default function AlbumItem({ albumName, albumTracksNumber }: AlbumItemProps) {
  const navigate = useNavigate()
  const actionsBtnRef = useRef<HTMLDivElement>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const iconStyle = useSettingsStore(s => s.iconStyle)

  const handleAlbumClick = () => {
    navigate(`/album/${encodeURIComponent(albumName)}`)
  }

  const t = useMappedTranslations({
    tracksNumber: 'album.item.tracksNumber',
    addToQueue: 'album.item.add-to-queue',
    overwriteQueue: 'album.item.overwrite-queue',
    addToQueueError: 'message.error.addToQueue',
    overwriteQueueError: 'message.error.overwriteQueue',
  })

  const menuItems: ActionMenuItem[] = [
    {
      key: 'add-to-queue',
      label: t.addToQueue,
      onClick: async () => {
        try {
          const tracks = await getAlbumTracks(albumName)
          for (const track of tracks) {
            musicPlayer.enqueue(track)
          }
        } catch (e) {
          showMessage(t.addToQueueError)
        }
      },
    },
    {
      key: 'overwrite-queue',
      label: t.overwriteQueue,
      onClick: async () => {
        try {
          const tracks = await getAlbumTracks(albumName)
          musicPlayer.setQueue(tracks)
        } catch (e) {
          showMessage(t.overwriteQueueError)
        }
      },
    },
  ]

  return (
    <div
      className="album-item-component-container"
      onClick={() => handleAlbumClick()}
    >
      <div className="album-item-component-icon-container">
        <Icon name="album" mode={iconStyle} size={24} folder='/images/AlbumItem/' />
      </div>
      <div className="album-item-component-text-container">
        <span className="album-item-component-title">{albumName}</span>
        <div className="album-item-component-info">
          <span className="album-item-component-tracks-number">{albumTracksNumber} {t.tracksNumber}</span>
        </div>
      </div>
      <div
        ref={actionsBtnRef}
        className="album-item-component-actions-container"
        onClick={e => { e.stopPropagation(); setMenuOpen(o => !o) }}
      >
        <Icon name="ellipsis" mode={null} folder="images/AlbumItem/" />
      </div>

      {menuOpen && (
        <ItemActionsMenu
          anchorEl={actionsBtnRef.current}
          items={menuItems}
          onClose={() => setMenuOpen(false)}
        />
      )}
    </div>
  )
}