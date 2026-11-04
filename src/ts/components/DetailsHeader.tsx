import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Track } from '../lib/db'
import { musicPlayer } from '../lib/music'
import { useTrackStore } from '../lib/trackStore'
import { playAll, shufflePlay } from '../lib/trackActions'
import { useSettingsStore } from '../lib/settingsStore'
import { useMappedTranslations } from '../lib/i18n'
import type { PlaylistIcon as PlaylistIconData } from '../lib/playlistIcon'
import { Icon } from './Icon'
import { ListIcon } from './ListIcon'
import { formatTime } from './MiniPlayer'
import { showMessage } from './Message'
import '../../css/components/DetailsHeader.css'

const ICON_FOLDERS = {
  artist: '/images/ArtistPage/',
  album: '/images/AlbumItem/',
}

interface DetailsHeaderProps {
  title: string
  trackIds: number[]
  art:
    | { kind: 'cd'; icon: PlaylistIconData | null; name: string; onClick: () => void }
    | { kind: keyof typeof ICON_FOLDERS }
  // ページ固有のボタン (タグの編集など)
  extraAction?: { icon: ReactNode; label?: string; onClick?: () => void }
}

export default function DetailsHeader({ title, trackIds, art, extraAction }: DetailsHeaderProps) {
  const tracksById = useTrackStore(s => s.tracksById)
  const iconStyle = useSettingsStore(s => s.iconStyle)

  const t = useMappedTranslations({
    tracksNumber: 'details.header.tracksNumber',
    addToQueue: 'details.header.add-to-queue',
    overwriteQueue: 'details.header.overwrite-queue',
    addedToQueue: 'message.success.addToQueue',
    overwroteQueue: 'message.success.overwriteQueue',
  })

  const totalDurationMs = useMemo(
    () => trackIds.reduce((sum, id) => sum + (tracksById[id]?.duration_ms ?? 0), 0),
    [trackIds, tracksById]
  )

  // ボタン行が上端に貼り付いているか。上部の下端がスクロール領域の上端を越えたら貼り付いている
  const heroRef = useRef<HTMLDivElement>(null)
  const [isStuck, setIsStuck] = useState(false)

  useEffect(() => {
    const hero = heroRef.current
    const scroller = hero?.parentElement // .page
    if (!hero || !scroller) return

    const update = () => {
      setIsStuck(hero.getBoundingClientRect().bottom < scroller.getBoundingClientRect().top + 1)
    }
    update()
    scroller.addEventListener('scroll', update, { passive: true })
    return () => scroller.removeEventListener('scroll', update)
  }, [])

  const toTracks = () => trackIds.map(id => tracksById[id]).filter((t): t is Track => Boolean(t))

  const handleAddToQueue = () => {
    for (const track of toTracks()) {
      musicPlayer.enqueue(track)
    }
    showMessage(t.addedToQueue)
  }

  const handleOverwriteQueue = () => {
    musicPlayer.setQueue(toTracks())
    showMessage(t.overwroteQueue)
  }

  return (
    <>
      <div className="dh-component-hero" ref={heroRef}>
        {art.kind === 'cd' ? (
          <div className="dh-component-cd-wrapper">
            <div className="dh-component-cd-jacket" onClick={art.onClick}>
              {art.icon && <ListIcon icon={art.icon} name={art.name} size={192} />}
            </div>
            <div className="dh-component-cd-disc" />
          </div>
        ) : (
          <div className="dh-component-avatar">
            <Icon name={art.kind} mode={iconStyle} size={40} folder={ICON_FOLDERS[art.kind]} />
          </div>
        )}
        <div className="dh-component-text">
          <p className="dh-component-title">{title}</p>
          <p className="dh-component-meta">{trackIds.length} {t.tracksNumber}・{formatTime(totalDurationMs)}</p>
        </div>
      </div>

      <div className={`dh-component-actions${isStuck ? ' is-stuck' : ''}`}>
        <div className="dh-component-actions-left">
          {extraAction && (
            <div className="dh-component-action" onClick={extraAction.onClick}>
              {extraAction.icon}
              {extraAction.label && <span>{extraAction.label}</span>}
            </div>
          )}
          <div className="dh-component-action" onClick={handleAddToQueue}>
            <Icon name="queue_add" mode={null} size={24} folder="/images/DetailsHeader/" />
            <span>{t.addToQueue}</span>
          </div>
          <div className="dh-component-action" onClick={handleOverwriteQueue}>
            <Icon name="queue_overwrite" mode={null} size={24} folder="/images/DetailsHeader/" />
            <span>{t.overwriteQueue}</span>
          </div>
        </div>

        <div className="dh-component-actions-right">
          <div onClick={() => shufflePlay(trackIds)}>
            <Icon name="shuffle" mode={null} size={24} folder="/images/PlaylistsPage/" />
          </div>
          <div className="dh-component-play" onClick={() => playAll(trackIds)}>
            <Icon name="play_all" mode={null} size={20} folder="/images/PlaylistsPage/" />
          </div>
        </div>
      </div>
    </>
  )
}
