import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams } from 'react-router-dom'
import { getAlbumTracks } from '../lib/db'
import { sortByTitle } from '../lib/trackStore'
import { playFromList } from '../lib/trackActions'
import MusicItem from '../components/MusicItem'
import DetailsHeader from '../components/DetailsHeader'
import { usePlayerStore } from '../lib/playerStore'
import { useScrollRestoration } from '../lib/scrollRestoration'

export default function AlbumDetailsPage() {
  const { name } = useParams<{ name: string }>()
  const albumName = name ? decodeURIComponent(name) : ''

  const [trackIds, setTrackIds] = useState<number[]>([])
  const pageRef = useRef<HTMLDivElement>(null)
  useScrollRestoration(pageRef, { ready: trackIds.length > 0 })

  const isMiniPlayerVisible = usePlayerStore(s => s.currentTrack)

  useEffect(() => {
    getAlbumTracks(albumName).then(fetched => {
      const sorted = sortByTitle(fetched)
      setTrackIds(sorted.map(t => t.id))
    })
  }, [albumName])

  const handlePlay = useCallback(
    (trackId: number) => playFromList(trackIds, trackId),
    [trackIds]
  )

  return (
    <div className="page fade-in" style={{ paddingBottom: 0 }} ref={pageRef}>
      <DetailsHeader title={albumName} trackIds={trackIds} art={{ kind: 'album' }} />
      <div style={{ marginBottom: isMiniPlayerVisible ? 'calc(24px + .8rem + 20px + .5rem)' : 0 }}>
        {trackIds.map(id => (
          <MusicItem key={id} trackId={id} onPlay={handlePlay} />
        ))}
      </div>
    </div>
  )
}