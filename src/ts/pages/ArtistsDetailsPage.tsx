import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams } from 'react-router-dom'
import { getAllTracks } from '../lib/db'
import { sortByTitle } from '../lib/trackStore'
import { playFromList } from '../lib/trackActions'
import { usePlayerStore } from '../lib/playerStore'
import { useScrollRestoration } from '../lib/scrollRestoration'
import MusicItem from '../components/MusicItem'
import DetailsHeader from '../components/DetailsHeader'

export default function ArtistsDetailsPage() {
  const { name } = useParams<{ name: string }>()
  const artistName = name ? decodeURIComponent(name) : ''

  const [trackIds, setTrackIds] = useState<number[]>([])
  const pageRef = useRef<HTMLDivElement>(null)
  useScrollRestoration(pageRef, { ready: trackIds.length > 0 })

  const isMiniPlayerVisible = usePlayerStore(s => s.currentTrack)

  useEffect(() => {
    getAllTracks().then(all => {
      const filtered = all.filter(t => (t.artist ?? '') === artistName)
      const sorted = sortByTitle(filtered)
      setTrackIds(sorted.map(x => x.id))
    })
  }, [artistName])

  const handlePlay = useCallback(
    (trackId: number) => playFromList(trackIds, trackId),
    [trackIds]
  )

  return (
    <div className="page fade-in" style={{ paddingBottom: 0 }} ref={pageRef}>
      <DetailsHeader title={artistName} trackIds={trackIds} art={{ kind: 'artist' }} />
      <div style={{ marginBottom: isMiniPlayerVisible ? 'calc(24px + .8rem + 20px + .5rem)' : 0 }}>
        {trackIds.map(id => (
          <MusicItem key={id} trackId={id} onPlay={handlePlay} />
        ))}
      </div>
    </div>
  )
}
