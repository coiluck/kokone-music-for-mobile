import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { getPlaylists, setPlaylistIcon } from '../../lib/db'
import {
  rollHue,
  getSvgColors,
  getIdenticonColors,
  SVG_NAMES,
  type PlaylistIcon as PlaylistIconData,
  type SvgIconName,
} from '../../lib/playlistIcon'
import { PlaylistIcon } from '../../components/PlaylistIcon'
import { Icon } from '../../components/Icon'

export default function PlaylistIconEditPage() {
  const { name } = useParams<{ name: string }>()
  const playlistName = name ? decodeURIComponent(name) : ''
  const navigate = useNavigate()

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
    <div className="page fade-in playlist-icon-edit-page">
      <div className="playlist-icon-edit-header">
        <span>{playlistName}</span>
      </div>

      {/* プレビュー（大） */}
      <div className="playlist-icon-edit-preview">
        <PlaylistIcon
          icon={buildIcon(selectedKind, hue)}
          name={playlistName}
          size={160}
        />
      </div>

      {/* サイコロボタン */}
      <div className="playlist-icon-edit-dice">
        <button onClick={() => setHue(rollHue())}>
          <Icon name="dice" mode={null} size={24} folder="/images/PlaylistsPage/" />
          <span>色をサイコロ</span>
        </button>
      </div>

      {/* 候補一覧 */}
      <div className="playlist-icon-edit-grid">
        {candidates.map((cand, i) => (
          <button
            key={i}
            className={`playlist-icon-edit-cell${isSelected(cand) ? ' is-selected' : ''}`}
            onClick={() => {
              setSelectedKind(
                cand.kind === 'auto'
                  ? { kind: 'auto' }
                  : { kind: 'svg', name: cand.name }
              )
            }}
          >
            <PlaylistIcon icon={cand} name={playlistName} size={80} />
          </button>
        ))}
      </div>

      {/* 確定ボタン */}
      <div className="playlist-icon-edit-actions">
        <button onClick={() => navigate(-1)}>キャンセル</button>
        <button onClick={() => void handleSave()}>決定</button>
      </div>
    </div>
  )
}