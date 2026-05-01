import { Track } from "../lib/db"
import { formatTime } from "../components/MiniPlayer"
import { useSettingsStore } from '../lib/settingsStore'
import { Icon } from "./Icon"
import '../../css/components/MusicItem.css'

interface Props {
  track: Track
  onPlay: (track: Track) => void
  onRemove?: () => void
}

export default function MusicItem({ track, onPlay, onRemove }: Props) {
  const iconStyle = useSettingsStore(s => s.iconStyle)

  const handleEditMeta = () => {
    console.log('Edit!');
  }

  return (
    <div
      className="mi-component-container"
      onClick={() => onPlay(track)}
    >
      <div className="mi-component-icon-container">
        <Icon name="music" mode={iconStyle} size={24} folder='/images/MiniPlayer/' />
      </div>
      <div className="mi-component-text-container">
        <span className="mi-component-title">{track.title}</span>
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
          className="mi-component-actions"
          onClick={e => { e.stopPropagation(); handleEditMeta(); }}
         >
          <Icon name="ellipsis" mode={null} folder="/images/MusicItem/" />
        </div>
      </div>
    </div>
  )
}