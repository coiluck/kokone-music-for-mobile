import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { getTagslists, getTagListTracks, setTaglistPositiveTags, setTaglistNegativeTags } from '../lib/db'
import { sortByTitle } from '../lib/trackStore'
import { playFromList, playAll, shufflePlay } from '../lib/trackActions'
import type { PlaylistIcon as PlaylistIconData } from '../lib/playlistIcon'
import { usePlayerStore } from '../lib/playerStore'
import MusicItem from '../components/MusicItem'
import { Icon } from '../components/Icon'
import { ListIcon } from '../components/ListIcon'
import { useMappedTranslations } from '../lib/i18n'
import '../../css/pages/TagsDetailsPage.css'
import { useSettingsStore } from '../lib/settingsStore'

export default function TagsDetailsPage() {
  const { listName } = useParams<{ listName: string }>()
  const navigate = useNavigate()

  const [trackIds, setTrackIds] = useState<number[]>([])
  const [listId, setListId] = useState<number | null>(null)
  const [positiveTags, setPositiveTags] = useState<string[]>([])
  const [negativeTags, setNegativeTags] = useState<string[]>([])
  const [icon, setIcon] = useState<PlaylistIconData | null>(null)
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const posInputRef = useRef<HTMLInputElement>(null)
  const negInputRef = useRef<HTMLInputElement>(null)
  const isPlaying = usePlayerStore(s => s.currentTrack)
  const iconStyle = useSettingsStore(s => s.iconStyle)

  const t = useMappedTranslations({
    editTitle: 'tags.details.edit.title',
    pos: 'tags.details.positive',
    neg: 'tags.details.negative',
    placeholder: 'tags.details.placeholder'
  })

  useEffect(() => {
    if (!listName) return
    const fetchData = async () => {
      const allLists = await getTagslists()
      const targetList = allLists.find(item => item.name === listName)
      if (!targetList) return

      setListId(targetList.id)
      setPositiveTags(targetList.positive_tags)
      setNegativeTags(targetList.negative_tags)
      setIcon(targetList.icon)

      const tracks = await getTagListTracks(targetList.positive_tags, targetList.negative_tags)
      const sorted = sortByTitle(tracks)
      setTrackIds(sorted.map(x => x.id))
    }
    fetchData()
  }, [listName])

  if (!listName) {
    console.error('[TagsDetailsPage] Invalid param')
    return null
  }

  const handlePlay = useCallback(
    (trackId: number) => playFromList(trackIds, trackId),
    [trackIds]
  )

  const handlePlayAll = useCallback(() => playAll(trackIds), [trackIds])

  const handleShuffle = useCallback(() => shufflePlay(trackIds), [trackIds])

  return (
    <div className='page fade-in'>
      {isMenuOpen && (
        <div
          className="tags-details-overlay"
          onClick={(e) => { e.preventDefault(); setIsMenuOpen(false) }}
         />
      )}

      <div className="tags-details-header">
        <div className="tags-details-header-title">{listName}</div>
        <div className="tags-details-header-icon-container">
          <div className="tags-details-header-cd-wrapper">
            <div
              className="tags-details-header-cd-jacket-container"
              onClick={() => navigate(`/icon-edit/taglist/${encodeURIComponent(listName)}`)}
            >
              <ListIcon icon={icon} name={listName} size={192} />
            </div>
            <div className="tags-details-header-cd-disc-icon" />
          </div>
        </div>
        <div className="tags-details-button-container">
          <div
            className="tags-details-button-left"
            onClick={() => setIsMenuOpen(true)}
          >
            <Icon name="sliders" mode={iconStyle} size={24} folder='/images/TagsPage/' />
          </div>
          <div className="tags-details-button-right">
            <div
              className="tags-details-button-right shuffle"
              onClick={handleShuffle}
            >
              <Icon name="shuffle" mode={null} size={24} folder='/images/PlaylistsPage/' />
            </div>
            <div
              className="tags-details-button-right play_all"
              onClick={handlePlayAll}
            >
              <Icon name="play_all" mode={null} size={16} folder='/images/PlaylistsPage/' />
            </div>
          </div>
        </div>
      </div>

      <div style={{ paddingBottom: isPlaying ? 'calc(24px + .8rem + 20px + .5rem)' : 0 }}> {/* MiniPlayerの高さ */}
        {trackIds.map(id => (
          <MusicItem key={id} trackId={id} onPlay={handlePlay} />
        ))}
      </div>

      {isMenuOpen && (
        <div className='tags-details-menu-container'>
          <div className="tags-details-menu-header">
            <span className="tags-details-menu-title">{t.editTitle}</span>
            <div
              className="ei-component-close-container"
              onClick={() => setIsMenuOpen(false)}
            >
              <Icon name="xmark" mode={null} size={16} folder="/images/EditInfoModal/" />
            </div>
          </div>

          {/* positive */}
          <div className='tags-details-menu-item'>
            <span className='tags-details-menu-item-label'>{t.pos}</span>
            <div className='tags-details-menu-item-main'>
              <div className='tags-details-menu-tags-container'>
                {positiveTags.map(tag => (
                  <span
                    key={tag}
                    className="tags-details-menu-tag-item"
                    onClick={async () => {
                      if (listId === null) return
                      const next = positiveTags.filter(t => t !== tag)
                      setPositiveTags(next)
                      await setTaglistPositiveTags(listId, next)
                      const updatedTracks = await getTagListTracks(next, negativeTags)
                      const sorted = sortByTitle(updatedTracks)
                      setTrackIds(sorted.map(x => x.id))
                    }}
                  >
                    {tag}
                  </span>
                ))}
              </div>
              <input
                className="tags-details-menu-input"
                type="text"
                enterKeyHint="enter"
                placeholder={t.placeholder}
                ref={posInputRef}
                onClick={e => e.stopPropagation()}
                onKeyDown={async e => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    const newTag = posInputRef.current?.value.trim()
                    if (newTag && !positiveTags.includes(newTag) && listId !== null) {
                      const next = [...positiveTags, newTag]
                      setPositiveTags(next)
                      await setTaglistPositiveTags(listId, next)
                      const updatedTracks = await getTagListTracks(next, negativeTags)
                      const sorted = sortByTitle(updatedTracks)
                      setTrackIds(sorted.map(x => x.id))
                    }
                    if (posInputRef.current) {
                      posInputRef.current.value = '';
                    }
                  }
                }}
              />
            </div>
          </div>

          {/* negative */}
          <div className='tags-details-menu-item'>
            <span className='tags-details-menu-item-label'>{t.neg}</span>
            <div className='tags-details-menu-item-main'>
              <div className='tags-details-menu-tags-container'>
                {negativeTags.map(tag => (
                  <span
                    key={tag}
                    className="tags-details-menu-tag-item"
                    onClick={async () => {
                      if (listId === null) return
                      const next = negativeTags.filter(t => t !== tag)
                      setNegativeTags(next)
                      await setTaglistNegativeTags(listId, next)
                      const updatedTracks = await getTagListTracks(positiveTags, next)
                      const sorted = sortByTitle(updatedTracks)
                      setTrackIds(sorted.map(x => x.id))
                    }}
                  >
                    {tag}
                  </span>
                ))}
              </div>
              <input
                className="tags-details-menu-input"
                type="text"
                enterKeyHint="enter"
                placeholder={t.placeholder}
                ref={negInputRef}
                onClick={e => e.stopPropagation()}
                onKeyDown={async e => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    const newTag = negInputRef.current?.value.trim()
                    if (newTag && !negativeTags.includes(newTag) && listId !== null) {
                      const next = [...negativeTags, newTag]
                      setNegativeTags(next)
                      await setTaglistNegativeTags(listId, next)
                      const updatedTracks = await getTagListTracks(positiveTags, next)
                      const sorted = sortByTitle(updatedTracks)
                      setTrackIds(sorted.map(x => x.id))
                    }
                    if (negInputRef.current) {
                      negInputRef.current.value = '';
                    }
                  }
                }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}