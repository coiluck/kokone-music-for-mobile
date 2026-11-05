import { useState } from 'react'
import { useSettingsStore } from '../lib/settingsStore'
import { useMappedTranslations } from '../lib/i18n'
import { Icon } from './Icon'
import { showMessage } from './Message'

interface Props {
  trackId: number
  initialAdded: boolean
  onToggle: (trackId: number, added: boolean) => Promise<void>
}

// 押すたびに曲をプレイリストへ追加・解除する
// 一覧全体を再描画しないよう、表示の状態はボタン自身が持つ
export default function PlaylistAddButton({ trackId, initialAdded, onToggle }: Props) {
  const iconStyle = useSettingsStore(s => s.iconStyle)
  const [added, setAdded] = useState(initialAdded)

  const t = useMappedTranslations({
    addToPlaylist: 'music.item.actions.add-to-playlist',
    addToPlaylistError: 'message.error.mi.add-to-playlist',
  })

  const handleClick = async (e: React.MouseEvent) => {
    e.stopPropagation()
    const next = !added
    setAdded(next)
    try {
      await onToggle(trackId, next)
    } catch (err) {
      setAdded(!next)
      showMessage(`${t.addToPlaylistError}: ${err}`, 'infinity')
    }
  }

  return (
    <div
      className="mi-component-actions"
      style={{ opacity: 1 }}
      role="button"
      aria-label={t.addToPlaylist}
      aria-pressed={added}
      onClick={handleClick}
    >
      {added
        ? <Icon name="check" mode={null} size={16} color="var(--color-accent)" folder="/images/MusicItem/" />
        : <Icon name="plus" mode={iconStyle} size={16} folder="/images/PlaylistsPage/" />}
    </div>
  )
}
