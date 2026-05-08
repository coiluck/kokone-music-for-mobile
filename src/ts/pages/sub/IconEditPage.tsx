import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  getPlaylists,
  getTagslists,
  setPlaylistIcon,
  setTaglistIcon,
} from '../../lib/db'
import {
  rollHue,
  SVG_NAMES,
  type PlaylistIcon as PlaylistIconData,
  type SvgIconName,
} from '../../lib/playlistIcon'
import { usePlayerStore } from '../../lib/playerStore'
import { ListIcon } from '../../components/ListIcon'
import { Icon } from '../../components/Icon'
import { useMappedTranslations } from '../../lib/i18n'
import '../../../css/pages/sub/IconEditPage.css'

type IconKind = 'playlist' | 'taglist'

export default function IconEditPage() {
  const { kind, name } = useParams<{ kind: IconKind; name: string }>()
  const targetName = name ? decodeURIComponent(name) : ''
  const navigate = useNavigate()
  const currentTrack = usePlayerStore(s => s.currentTrack)

  const t = useMappedTranslations({
    cancel: 'playlist.icon.edit.cancel',
    save: 'playlist.icon.edit.save',
  })

  const [targetId, setTargetId] = useState<number | null>(null)
  const [hue, setHue] = useState<number>(() => rollHue())
  const [selectedKind, setSelectedKind] =
    useState<{ kind: 'svg'; name: SvgIconName } | { kind: 'auto' }>(
      { kind: 'svg', name: 'icon1' }
    )

  // 初期値: 既存のアイコンを読み込む（kind に応じて取得元を切り替え）
  useEffect(() => {
    if (!kind) return
    const fetcher = kind === 'playlist' ? getPlaylists : getTagslists
    fetcher().then(items => {
      const item = items.find(i => i.name === targetName)
      if (!item) return
      setTargetId(item.id)
      if (item.icon) {
        setHue(item.icon.hue)
        if (item.icon.kind === 'auto') setSelectedKind({ kind: 'auto' })
        else setSelectedKind({ kind: 'svg', name: item.icon.name })
      }
    })
  }, [kind, targetName])

  const buildIcon = (
    sel: typeof selectedKind,
    h: number
  ): PlaylistIconData =>
    sel.kind === 'auto'
      ? { kind: 'auto', hue: h }
      : { kind: 'svg', name: sel.name, hue: h }

  const handleSave = async () => {
    if (targetId == null || !kind) return
    const setter = kind === 'playlist' ? setPlaylistIcon : setTaglistIcon
    await setter(targetId, buildIcon(selectedKind, hue))
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
        <span className="ie-page-header-title">{targetName}</span>
      </div>

      {/* プレビュー（大） */}
      <div className="ie-page-preview">
        <ListIcon
          icon={buildIcon(selectedKind, hue)}
          name={targetName}
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
            <ListIcon icon={cand} name={targetName} size={80} />
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