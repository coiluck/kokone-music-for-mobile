// Components/ArtistItem.tsx
import { useSettingsStore } from '../lib/settingsStore'
import { useNavigate } from 'react-router-dom'
import { useMappedTranslations } from '../lib/i18n'
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
  })
  const iconStyle = useSettingsStore(s => s.iconStyle)

  const handleArtistMeta = () => {
    console.log('Edit!');
  }

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
        className="ai-component-actions"
        onClick={e => { e.stopPropagation(); handleArtistMeta(); }}
      >
        <Icon name="ellipsis" mode={null} folder="images/ArtistItem/" />
      </div>
    </div>
  )
}