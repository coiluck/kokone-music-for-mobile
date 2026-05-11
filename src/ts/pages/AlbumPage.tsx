import { useEffect, useState } from 'react'
import { getAlbums } from '../lib/db'
import { usePlayerStore } from '../lib/playerStore'
import { useMappedTranslations } from '../lib/i18n'
import AlbumItem from '../components/AlbumItem'

export default function AlbumPage() {
  const [albums, setAlbums] = useState<{ album: string; count: number }[]>([])
  const isPlayerVisible = usePlayerStore(s => s.currentTrack)

  const t = useMappedTranslations({
    count: 'album.page.count',
    empty: 'album.page.empty',
  })

  useEffect(() => {
    getAlbums().then(setAlbums)
  }, [])

  return (
    <div className="page fade-in">
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