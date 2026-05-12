import { useEffect, useRef, useState } from 'react'
import { getAlbums } from '../lib/db'
import { usePlayerStore } from '../lib/playerStore'
import { useMappedTranslations } from '../lib/i18n'
import { useScrollRestoration } from '../lib/scrollRestoration'
import AlbumItem from '../components/AlbumItem'

export default function AlbumPage() {
  const [albums, setAlbums] = useState<{ album: string; count: number }[]>([])
  const isPlayerVisible = usePlayerStore(s => s.currentTrack)
  const pageRef = useRef<HTMLDivElement>(null)

  const t = useMappedTranslations({
    count: 'album.page.count',
    empty: 'album.page.empty',
  })

  useEffect(() => {
    getAlbums().then(setAlbums)
  }, [])

  useScrollRestoration(pageRef, { ready: albums.length > 0 })

  return (
    <div className="page fade-in" ref={pageRef}>
      <div className="album-list-toolbar">
        <span className="album-list-count">{albums.length} {t.count}</span>
      </div>

      <div
        className="album-list-main-container"
        style={{ paddingBottom: isPlayerVisible ? 'calc(24px + .8rem + 20px + .5rem)' : 0 }}
      >
        {albums.length === 0 ? (
          <p>{t.empty}</p>
        ) : (
          albums.map(album => (
            <AlbumItem key={album.album} albumName={album.album} albumTracksNumber={album.count} />
          ))
        )}
      </div>
    </div>
  )
}