import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { getPlaylists, setPlaylistIcon } from '../../lib/db'
import {
  rollHue,
  SVG_NAMES,
  type PlaylistIcon as PlaylistIconData,
  type SvgIconName,
} from '../../lib/playlistIcon'
import { usePlayerStore } from '../../lib/playerStore'
import { PlaylistIcon } from '../../components/PlaylistIcon'
import { Icon } from '../../components/Icon'
import { useMappedTranslations } from '../../lib/i18n'
import '../../../css/pages/sub/IconEditPage.css'

export default function PlaylistIconEditPage() {
  const { name } = useParams<{ name: string }>()
  const playlistName = name ? decodeURIComponent(name) : ''
  const navigate = useNavigate()
  const currentTrack = usePlayerStore(s => s.currentTrack)

  const t = useMappedTranslations({
    cancel: 'playlist.icon.edit.cancel',
    save: 'playlist.icon.edit.save',
  })

  const [playlistId, setPlaylistId] = useState<number | null>(null)
  const [hue, setHue] = useState<number>(() => rollHue())
  const [selectedKind, setSelectedKind] =
    useState<{ kind: 'svg'; name: SvgIconName } | { kind: 'auto' }>(
      { kind: 'svg', name: 'icon1' }
    )

  // 初期値: 既存のプレイリストのアイコンを読み込む
  useEffect(() => {
    getPlaylists().then(playlists => {
      const pl = playlists.find(p => p.name === playlistName)
      if (!pl) return
      setPlaylistId(pl.id)
      if (pl.icon) {
        setHue(pl.icon.hue)
        if (pl.icon.kind === 'auto') setSelectedKind({ kind: 'auto' })
        else setSelectedKind({ kind: 'svg', name: pl.icon.name })
      }
    })
  }, [playlistName])

  const buildIcon = (
    sel: typeof selectedKind,
    h: number
  ): PlaylistIconData =>
    sel.kind === 'auto'
      ? { kind: 'auto', hue: h }
      : { kind: 'svg', name: sel.name, hue: h }

  const handleSave = async () => {
    if (playlistId == null) return
    await setPlaylistIcon(playlistId, buildIcon(selectedKind, hue))
    navigate(-1)
  }

  const candidates: PlaylistIconData[] = [
    ...SVG_NAMES.map<PlaylistIconData>(n => ({ kind: 'svg', name: n, hue })),
    { kind: 'auto', hue },
  ]

  const isSelected = (cand: PlaylistIconData) =>
    cand.kind === selectedKind.kind &&
    (cand.kind === 'auto' || cand.name === (selectedKind as { name: SvgIconName }).name)

  return (
    <div className="page fade-in" style={{ paddingBottom: '0' }}>
      <div className="ie-page-header">
        <span className="ie-page-header-title">{playlistName}</span>
      </div>

      {/* プレビュー（大） */}
      <div className="ie-page-preview">
        <PlaylistIcon
          icon={buildIcon(selectedKind, hue)}
          name={playlistName}
          size={160}
        />
      </div>

      {/* サイコロボタン */}
      <div className="ie-page-dice">
        <div onClick={() => setHue(rollHue())} className="ie-page-dice-inner">
          <Icon name="dice" mode={null} size={32} folder="/images/PlaylistsPage/" />
        </div>
      </div>

      {/* 候補一覧 */}
      <div className="ie-page-candidate-grid">
        {candidates.map((cand, i) => (
          <div
            key={i}
            className={`ie-page-candidate-item${isSelected(cand) ? ' selected' : ''}`}
            onClick={() => {
              setSelectedKind(
                cand.kind === 'auto'
                  ? { kind: 'auto' }
                  : { kind: 'svg', name: cand.name }
              )
            }}
          >
            <PlaylistIcon icon={cand} name={playlistName} size={80} />
          </div>
        ))}
      </div>

      {/* 確定ボタン */}
      <div className={`ie-page-actions${currentTrack ? ' playing' : ''}`}>
        <div
          className="ie-page-actions-button"
          onClick={() => navigate(-1)}
        >
          {t.cancel}
        </div>
        <div
          className="ie-page-actions-button primary"
          onClick={() => void handleSave()}
        >
          {t.save}
        </div>
      </div>
    </div>
  )
}