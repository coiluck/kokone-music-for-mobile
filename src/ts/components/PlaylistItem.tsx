import { Playlist } from "../lib/db"
import { formatTime } from "../components/MiniPlayer"
import { Icon } from "./Icon"
import { PlaylistIcon as PlaylistIconView } from "./PlaylistIcon"
import type { PlaylistIcon as PlaylistIconData } from "../lib/playlistIcon"
import '../../css/components/PlaylistItem.css'

interface Props {
  playlist: Playlist
}

export default function PlaylistItem({ playlist }: Props) {
  const icon = playlist.icon

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
        className="pli-component-actions"
        onClick={e => { e.stopPropagation()}}
      >
        <Icon name="ellipsis" mode={null} folder="/images/MusicItem/" />
      </div>
    </div>
  )
}