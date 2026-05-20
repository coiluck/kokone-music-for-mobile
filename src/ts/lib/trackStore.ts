import { create } from 'zustand'
import { getAllTracks, type Track } from './db'

function sortByTitle(tracks: Track[]): Track[] {
  return [...tracks].sort((a, b) =>
    (a.title ?? '').localeCompare(b.title ?? '', 'ja', { sensitivity: 'variant', numeric: true })
  )
}

type TrackStore = {
  tracksById: Record<number, Track>
  trackOrder: number[]
  loading: boolean

  hydrate: () => Promise<void> // DB から全件取得して store を初期化する
  updateTrackLocal: (id: number, patch: Partial<Track>) => void // ローカル state のみ更新する（DB 更新は呼び出し側で済ませる前提）
}

// trackOrder を sortByTitle で再計算する。
// tracksById は更新後のものを渡すこと。
function recomputeOrder(tracksById: Record<number, Track>): number[] {
  return sortByTitle(Object.values(tracksById)).map(t => t.id)
}

export const useTrackStore = create<TrackStore>((set, get) => ({
  tracksById: {},
  trackOrder: [],
  loading: false,

  hydrate: async () => {
    set({ loading: true })
    const tracks = await getAllTracks()
    const sorted = sortByTitle(tracks)
    const byId: Record<number, Track> = {}
    for (const t of sorted) byId[t.id] = t
    set({
      tracksById: byId,
      trackOrder: sorted.map(t => t.id),
      loading: false,
    })
  },

  updateTrackLocal: (id, patch) => {
    const state = get()
    const prev = state.tracksById[id]
    if (!prev) return

    const next: Track = { ...prev, ...patch }
    const nextTracksById = { ...state.tracksById, [id]: next }

    // title が変わった時だけ trackOrder を作り直す
    const titleChanged = patch.title !== undefined && patch.title !== prev.title
    const nextOrder = titleChanged
      ? recomputeOrder(nextTracksById)
      : state.trackOrder

    set({
      tracksById: nextTracksById,
      trackOrder: nextOrder,
    })
  },
}))