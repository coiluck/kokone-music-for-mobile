import { useCallback, useEffect, useState } from 'react'
import { getAllTracks, searchTracks } from './db'
import { sortByTitle } from './trackStore'
import { useScanStore } from './scanStore'

// 検索語とタグで曲を絞り込む。スキャンが完了したら読み直す
export function useTrackSearch(initialTags: string[] = []) {
  const [trackIds, setTrackIds] = useState<number[]>([])
  const [query, setQuery] = useState('')
  const [tags, setTags] = useState<string[]>(initialTags)
  const [loading, setLoading] = useState(false)
  const scanVersion = useScanStore(s => s.scanVersion)

  const load = useCallback(async (q: string, currentTags: string[]) => {
    setLoading(true)
    const result = q.trim() || currentTags.length > 0
      ? await searchTracks(q, currentTags)
      : await getAllTracks()
    const sorted = sortByTitle(result)
    setTrackIds(sorted.map(x => x.id))
    setLoading(false)
  }, [])

  useEffect(() => {
    load(query, tags)
  }, [scanVersion, query, tags, load])

  return { trackIds, query, setQuery, tags, setTags, loading }
}
