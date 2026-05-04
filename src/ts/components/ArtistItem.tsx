// Components/ArtistItem.tsx
import { useRef, useState } from "react"
import { useSettingsStore } from '../lib/settingsStore'
import { useNavigate } from 'react-router-dom'
import { useMappedTranslations } from '../lib/i18n'
import ItemActionsMenu, { type ActionMenuItem } from "./ItemActionsMenu"
import { Icon } from "../components/Icon"
import '../../css/components/ArtistItem.css'

interface ArtistItemProps {
  artistName: string
  artistTracksNumber: number
}

export default function ArtistItem({ artistName, artistTracksNumber }: ArtistItemProps) {
  const navigate = useNavigate()
  const handleArtistClick = () => {
    navigate(`/artist/${encodeURIComponent(artistName)}`)
  }

  const t = useMappedTranslations({
    tracksNumber: 'artist.item.tracksNumber',
    addToQueue: 'artist.item.add-to-queue',
    playNext: 'artist.item.play-next',
  })

  const actionsBtnRef = useRef<HTMLDivElement>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const iconStyle = useSettingsStore(s => s.iconStyle)

  const menuItems: ActionMenuItem[] = [
    {
      key: 'add-to-queue',
      label: t.addToQueue,
      onClick: () => console.log('[ArtistItem] add to queue:', artistName),
    },
    {
      key: 'play-next',
      label: t.playNext,
      onClick: () => console.log('[ArtistItem] play next:', artistName),
    },
  ]

  return (
    <div
      className="ai-component-container"
      onClick={() => handleArtistClick()}
    >
      <div className="ai-component-icon-container">
        <Icon name="artist" mode={iconStyle} size={24} folder='/images/ArtistItem/' />
      </div>
      <div className="ai-component-text-container">
        <span className="ai-component-title">{artistName}</span>
        <div className="ai-component-info">
          <span className="ai-component-tracks-number">{artistTracksNumber} {t.tracksNumber}</span>
        </div>
      </div>
      <div
        ref={actionsBtnRef}
        className="ai-component-actions"
        onClick={e => { e.stopPropagation(); setMenuOpen(o => !o) }}
      >
        <Icon name="ellipsis" mode={null} folder="images/ArtistItem/" />
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