import { useRef, useState, useEffect, useMemo } from "react"
import { invoke } from "@tauri-apps/api/core"
import { Track, Playlist, getPlaylists, addTrackToPlaylist, removeTrackFromPlaylist, updateTrack } from "../lib/db"
import { usePlayerStore } from "../lib/playerStore"
import { useSettingsStore } from '../lib/settingsStore'
import { musicPlayer } from "../lib/music"
import { formatTime } from "../components/MiniPlayer"
import { Icon } from "./Icon"
import ItemActionsMenu, { type ActionMenuItem } from "./ItemActionsMenu"
import EditInfoModal from "./EditInfoModal"
import { useMappedTranslations } from "../lib/i18n"
import '../../css/components/MusicItem.css'
import { PlaylistIcon as PlaylistIconView } from "./PlaylistIcon"
import { showMessage } from "./Message"

interface Props {
  track: Track
  onPlay: (track: Track) => void
  onRemove?: () => void
}

export default function MusicItem({ track, onPlay, onRemove }: Props) {
  const iconStyle = useSettingsStore(s => s.iconStyle)

  const isItemPlaying = usePlayerStore(s => s.currentTrack?.id === track.id)
  const isItemPausing = usePlayerStore(s => s.currentTrack?.id === track.id && !s.isPlaying)

  const actionsBtnRef = useRef<HTMLDivElement>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [selectPlaylistOpen, setSelectPlaylistOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)

  // プレイリストの選択状態を管理するためのState
  const [playlists, setPlaylists] = useState<Playlist[]>([])
  const [initialSelectedPlaylistIds, setInitialSelectedPlaylistIds] = useState<Set<number>>(new Set())
  const [selectedPlaylistIds, setSelectedPlaylistIds] = useState<Set<number>>(new Set())

  const [localTrack, setLocalTrack] = useState<Track>(track)
  const sortedTags = useMemo(
    () => [...localTrack.tags].sort((a, b) => a.localeCompare(b, 'ja')),
    [localTrack.tags]
  )
  const titleInputRef = useRef<HTMLInputElement>(null)
  const artistInputRef = useRef<HTMLInputElement>(null)
  const [tagInput, setTagInput] = useState('')

  const handleSaveEdit = async () => {
    const title = titleInputRef.current?.value.trim() ?? track.title
    const artist = artistInputRef.current?.value.trim() ?? track.artist
    try {
      await invoke('edit_track_metadata', {
        payload: {
          path: track.path,
          title,
          artist,
        },
      })

      // DB更新（tagsもここで反映）
      await updateTrack(track.id, {
        title,
        artist,
        tags: localTrack.tags,
      })

      setLocalTrack(prev => ({ ...prev, title, artist }))
    } catch (e) {
      showMessage(`${t.editInfoError}: ${e}`, 'infinity')
    }
  }

  useEffect(() => {
    setLocalTrack(track)
  }, [track])

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
  })

  // プレイリスト追加モーダルが開かれたらデータを取得・ソートしてStateにセット
  useEffect(() => {
    if (selectPlaylistOpen) {
      getPlaylists().then(data => {
        const sorted = data.sort((a, b) => a.name.localeCompare(b.name, 'ja'))
        setPlaylists(sorted)

        // 既にこの曲が含まれているプレイリストを選択状態
        const initialIds = new Set<number>()
        sorted.forEach(pl => {
          if (pl.trackIds.includes(track.id)) {
            initialIds.add(pl.id)
          }
        })
        setInitialSelectedPlaylistIds(initialIds)
        setSelectedPlaylistIds(new Set(initialIds))
      })
    }
  }, [selectPlaylistOpen, track.id])

  // プレイリストのクリックでチェック状態をトグル
  const togglePlaylist = (id: number) => {
    setSelectedPlaylistIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // 保存ボタン押下時の処理
  const handleSavePlaylists = async () => {
    const promises: Promise<void>[] = []

    for (const pl of playlists) {
      const wasSelected = initialSelectedPlaylistIds.has(pl.id)
      const isSelected = selectedPlaylistIds.has(pl.id)

      if (!wasSelected && isSelected) {
        // 新たに選択された
        promises.push(addTrackToPlaylist(pl.id, track.id))
      } else if (wasSelected && !isSelected) {
        // 選択が解除された
        promises.push(removeTrackFromPlaylist(pl.id, track.id))
      }
    }

    await Promise.all(promises)
    setSelectPlaylistOpen(false)
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
        const current = musicPlayer.getQueue().filter(t => t.id !== track.id)
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
      onClick={() => { if (!isItemPlaying) onPlay(track); }}
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
        <span className={`mi-component-title ${isItemPlaying ? 'playing' : ''}`}>{localTrack.title}</span>
        <div className="mi-component-info">
          <div className="mi-component-info-left">
            <span className="mi-component-artist">{localTrack.artist}</span>
            {track.duration_ms != null && (
              <>
                <span className="mi-component-separator">・</span>
                <span className="mi-component-duration">
                  {formatTime(track.duration_ms)}
                </span>
              </>
            )}
          </div>
          {localTrack.tags.length > 0 && (
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
                      <PlaylistIconView icon={pl.icon} name={pl.name} size={32} />
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
                defaultValue={localTrack.title}
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
                defaultValue={localTrack.artist ?? ''}
                onClick={e => e.stopPropagation()}
              />
            </div>
            <div className="ei-component-field">
              <label className="ei-component-field-label">{t.editInfoTags}</label>
              {/* タグ一覧 */}
              <div className="mi-component-tags-input-container">
                <div className="mi-component-tags-container">
                  {localTrack.tags.map(tag => (
                    <span
                      key={tag}
                      className="mi-component-tags-item"
                      onClick={() => {
                        setLocalTrack(prev => ({
                          ...prev,
                          tags: prev.tags.filter(t => t !== tag)
                        }));
                      }}
                    >
                      {tag}
                    </span>
                  ))}
                </div>
                <input
                  className="ei-component-field-input"
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
                      if (newTag && !localTrack.tags.includes(newTag)) {
                        setLocalTrack(prev => ({ ...prev, tags: [...prev.tags, newTag] }))
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