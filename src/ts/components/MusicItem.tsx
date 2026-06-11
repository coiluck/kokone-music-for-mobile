import { useRef, useState, useEffect, useMemo } from "react"
import { invoke } from "@tauri-apps/api/core"
import { Playlist, getPlaylists, addTrackToPlaylist, removeTrackFromPlaylist, updateTrack } from "../lib/db"
import { useTrackStore } from "../lib/trackStore"
import { usePlayerStore } from "../lib/playerStore"
import { useSettingsStore } from '../lib/settingsStore'
import { musicPlayer } from "../lib/music"
import { formatTime } from "../components/MiniPlayer"
import { Icon } from "./Icon"
import ItemActionsMenu, { type ActionMenuItem } from "./ItemActionsMenu"
import EditInfoModal from "./EditInfoModal"
import { useMappedTranslations } from "../lib/i18n"
import '../../css/components/MusicItem.css'
import { ListIcon } from "./ListIcon"
import { showMessage } from "./Message"

interface Props {
  trackId: number
  onPlay: (trackId: number) => void
  onRemove?: () => void
}

export default function MusicItem({ trackId, onPlay, onRemove }: Props) {
  const iconStyle = useSettingsStore(s => s.iconStyle)

  // 自分の ID のレコードだけを購読する
  const track = useTrackStore(s => s.tracksById[trackId])
  const updateTrackLocal = useTrackStore(s => s.updateTrackLocal)

  const isItemPlaying = usePlayerStore(s => s.currentTrack?.id === trackId)
  const isItemPausing = usePlayerStore(s => s.currentTrack?.id === trackId && !s.isPlaying)

  const actionsBtnRef = useRef<HTMLDivElement>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [selectPlaylistOpen, setSelectPlaylistOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)

  // プレイリストの選択状態
  const [playlists, setPlaylists] = useState<Playlist[]>([])
  const [initialSelectedPlaylistIds, setInitialSelectedPlaylistIds] = useState<Set<number>>(new Set())
  const [selectedPlaylistIds, setSelectedPlaylistIds] = useState<Set<number>>(new Set())

  // 編集モーダル内のタグ一時状態（保存するまで store には反映しない）
  const [editingTags, setEditingTags] = useState<string[]>([])
  const [tagInput, setTagInput] = useState('')
  const titleInputRef = useRef<HTMLInputElement>(null)
  const artistInputRef = useRef<HTMLInputElement>(null)

  const sortedTags = useMemo(
    () => track ? [...track.tags].sort((a, b) => a.localeCompare(b, 'ja')) : [],
    [track?.tags]
  )

  const t = useMappedTranslations({
    editInfoTitle: 'music.item.edit-info.title',
    editInfoName: 'music.item.edit-info.name',
    editInfoNamePlaceholder: 'music.item.edit-info.name.placeholder',
    editInfoArtist: 'music.item.edit-info.artist',
    editInfoArtistPlaceholder: 'music.item.edit-info.artist.placeholder',
    editInfoTags: 'music.item.edit-info.tags',
    editInfoTagsPlaceholder: 'music.item.edit-info.tags.placeholder',
    editInfoAlbum: 'music.item.edit-info.album',
    editInfoCancel: 'music.item.edit-info.cancel',
    editInfoSave: 'music.item.edit-info.save',
    addToQueue: 'music.item.actions.add-to-queue',
    playNext: 'music.item.actions.play-next',
    addToPlaylist: 'music.item.actions.add-to-playlist',
    count: 'music.item.count',
    editInfoError: 'message.error.mi.edit-info',
    storagePermissionError: 'message.error.mi.storage-permission',
    addToPlaylistError: 'message.error.mi.add-to-playlist',
    renameInvalidChars: 'message.error.mi.rename-invalid-chars',
    renameFailed: 'message.error.mi.rename-failed',
  })

  // 編集モーダルが開かれたタイミングで現在の tags をコピー
  useEffect(() => {
    if (editOpen && track) {
      setEditingTags([...track.tags])
      setTagInput('')
    }
  }, [editOpen, track])

  // プレイリスト追加モーダルが開かれたらデータを取得
  useEffect(() => {
    if (selectPlaylistOpen) {
      getPlaylists().then(data => {
        const sorted = data.sort((a, b) => a.name.localeCompare(b.name, 'ja'))
        setPlaylists(sorted)

        const initialIds = new Set<number>()
        sorted.forEach(pl => {
          if (pl.trackIds.includes(trackId)) {
            initialIds.add(pl.id)
          }
        })
        setInitialSelectedPlaylistIds(initialIds)
        setSelectedPlaylistIds(new Set(initialIds))
      })
    }
  }, [selectPlaylistOpen, trackId])

  // track が削除された等で消えた場合は何も描画しない
  if (!track) return null

  const handleSaveEdit = async () => {
    const title = titleInputRef.current?.value.trim() || track.title
    const artist = artistInputRef.current?.value.trim() || track.artist
    try {
      // タイトルが実際に変わったときだけファイル名のリネームを要求する (Android のみ)。
      const res = await invoke<{ newPath: string | null; renameError: string | null }>(
        'edit_track_metadata',
        {
          payload: {
            path: track.path,
            title,
            artist,
            renameToTitle: title !== track.title,
          },
        }
      )

      // リネーム成功時は新しいパスを DB/store にも反映する。
      const newPath = res?.newPath ?? undefined

      // DB 更新
      await updateTrack(track.id, {
        title,
        artist,
        tags: editingTags,
        path: newPath,
      })

      // store 更新（title が変われば trackOrder も再計算される）
      updateTrackLocal(track.id, {
        title,
        artist,
        tags: editingTags,
        ...(newPath ? { path: newPath } : {}),
      })

      // タグ書き込みは成功したがリネームだけ失敗したケースを警告表示する。
      if (res?.renameError) {
        if (res.renameError.includes('INVALID_FILENAME_CHARS')) {
          showMessage(t.renameInvalidChars, 'infinity')
        } else {
          showMessage(t.renameFailed, 'infinity')
        }
      }
    } catch (e) {
      // Android: 全ファイルアクセス未許可のとき edit_track_metadata がこのトークンを返す。
      // 設定画面は Rust 側で既に開いているので、許可して再保存するよう案内する。
      if (String(e).includes('NEED_STORAGE_PERMISSION')) {
        showMessage(t.storagePermissionError, 'infinity')
      } else {
        showMessage(`${t.editInfoError}: ${e}`, 'infinity')
      }
    }
  }

  const togglePlaylist = (id: number) => {
    setSelectedPlaylistIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleSavePlaylists = async () => {
    const promises: Promise<void>[] = []

    for (const pl of playlists) {
      const wasSelected = initialSelectedPlaylistIds.has(pl.id)
      const isSelected = selectedPlaylistIds.has(pl.id)

      if (!wasSelected && isSelected) {
        promises.push(addTrackToPlaylist(pl.id, trackId))
      } else if (wasSelected && !isSelected) {
        promises.push(removeTrackFromPlaylist(pl.id, trackId))
      }
    }

    try {
      await Promise.all(promises)
      setSelectPlaylistOpen(false)
    } catch (e) {
      showMessage(`${t.addToPlaylistError}: ${e}`, 'infinity')
    }
  }

  const menuItems: ActionMenuItem[] = [
    {
      key: 'add-to-queue',
      label: t.addToQueue,
      onClick: () => {
        musicPlayer.enqueue(track)
      },
    },
    {
      key: 'play-next',
      label: t.playNext,
      onClick: () => {
        const current = musicPlayer.getQueue().filter(q => q.id !== track.id)
        musicPlayer.setQueue([track, ...current])
      },
    },
    {
      key: 'add-to-playlist',
      label: t.addToPlaylist,
      onClick: () => setSelectPlaylistOpen(true),
    },
    {
      key: 'edit-info',
      label: t.editInfoTitle,
      separatorBefore: true,
      onClick: () => setEditOpen(true),
    },
  ]

  return (
    <div
      className="mi-component-container"
      onClick={() => { if (!isItemPlaying) onPlay(trackId); }}
    >
      <div className={`mi-component-icon-container ${isItemPlaying ? 'playing' : ''}`}>
        {isItemPlaying ? (
          <div className={`mi-component-icon-container-playing ${isItemPausing ? 'paused' : ''}`} >
            <span></span>
            <span></span>
            <span></span>
            <span></span>
            <span></span>
          </div>
        ) : (
          <Icon name="music" mode={iconStyle} size={24} folder='/images/MiniPlayer/' />
        )}
      </div>
      <div className="mi-component-text-container">
        <span className={`mi-component-title ${isItemPlaying ? 'playing' : ''}`}>{track.title}</span>
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
              {sortedTags.map(tag => (
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
          ref={actionsBtnRef}
          className="mi-component-actions"
          onClick={e => {
            e.stopPropagation()
            setMenuOpen(o => !o)
          }}
         >
          <Icon name="ellipsis" mode={null} folder="/images/MusicItem/" />
        </div>
      </div>

      {menuOpen && (
        <ItemActionsMenu
          anchorEl={actionsBtnRef.current}
          items={menuItems}
          onClose={() => setMenuOpen(false)}
        />
      )}

      {selectPlaylistOpen && (
        <EditInfoModal
          title={t.addToPlaylist}
          onClose={() => setSelectPlaylistOpen(false)}
        >
          <div className="mi-component-select-playlist-container">
            <div className="ei-component-main-container">
              {playlists.map(pl => {
                const isChecked = selectedPlaylistIds.has(pl.id)
                return (
                  <div
                    key={pl.id}
                    className={`mi-component-playlist-item ${isChecked ? 'checked' : ''}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      togglePlaylist(pl.id)
                    }}
                  >
                    <div className="mi-component-playlist-item-icon-container">
                      <ListIcon icon={pl.icon} name={pl.name} size={32} />
                    </div>
                    <span className="mi-component-playlist-item-text-container">
                      <span className="mi-component-playlist-item-text-name">{pl.name}</span>
                      <span className="mi-component-playlist-item-text-count">{pl.trackIds.length} {t.count}</span>
                    </span>
                  </div>
                )
              })}
            </div>
            <div className="ei-component-footer">
              <button
                type="button"
                className="ei-component-button"
                onClick={e => { e.stopPropagation(); setSelectPlaylistOpen(false) }}
              >
                {t.editInfoCancel}
              </button>
              <button
                type="button"
                className="ei-component-button primary"
                onClick={e => {
                  e.stopPropagation()
                  handleSavePlaylists()
                }}
              >
                {t.editInfoSave}
              </button>
            </div>
          </div>
        </EditInfoModal>
      )}

      {editOpen && (
        <EditInfoModal
          title={t.editInfoTitle}
          onClose={() => setEditOpen(false)}
        >
          <div className="ei-component-main-container">
            <div className="ei-component-field">
              <label className="ei-component-field-label">{t.editInfoName}</label>
              <input
                className="ei-component-field-input"
                type="text"
                placeholder={t.editInfoNamePlaceholder}
                ref={titleInputRef}
                defaultValue={track.title}
                onClick={e => e.stopPropagation()}
              />
            </div>
            <div className="ei-component-field">
              <label className="ei-component-field-label">{t.editInfoArtist}</label>
              <input
                className="ei-component-field-input"
                type="text"
                placeholder={t.editInfoArtistPlaceholder}
                ref={artistInputRef}
                defaultValue={track.artist ?? ''}
                onClick={e => e.stopPropagation()}
              />
            </div>
            <div className="ei-component-field">
              <label className="ei-component-field-label">{t.editInfoTags}</label>
              <div className="mi-component-tags-input-container">
                {editingTags.length > 0 && (
                  <div className="mi-component-tags-container">
                    {editingTags.map(tag => (
                      <span
                        key={tag}
                        className="mi-component-tags-item"
                        onClick={() => {
                          setEditingTags(prev => prev.filter(x => x !== tag))
                        }}
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
                <input
                  type="text"
                  enterKeyHint="enter"
                  placeholder={t.editInfoTagsPlaceholder}
                  onClick={e => e.stopPropagation()}
                  value={tagInput}
                  onChange={e => setTagInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      const newTag = tagInput.trim()
                      if (newTag && !editingTags.includes(newTag)) {
                        setEditingTags(prev => [...prev, newTag])
                      }
                      setTagInput('')
                    }
                  }}
                />
              </div>
            </div>
          </div>
          <div className="ei-component-footer">
            <button
              type="button"
              className="ei-component-button"
              onClick={e => { e.stopPropagation(); setEditOpen(false) }}
            >
              {t.editInfoCancel}
            </button>
            <button
              type="button"
              className="ei-component-button primary"
              onClick={e => {
                e.stopPropagation()
                handleSaveEdit()
                setEditOpen(false)
              }}
            >
              {t.editInfoSave}
            </button>
          </div>
        </EditInfoModal>
      )}
    </div>
  )
}