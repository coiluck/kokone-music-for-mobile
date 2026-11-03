// music/ のテスト用
import type { Track } from '../db'

export function track(id: number): Track {
  return {
    id,
    file_hash: `hash${id}`,
    path: `/music/${id}.mp3`,
    title: `曲${id}`,
    artist: 'artist',
    album: null,
    tags: [],
    duration_ms: null,
    lufs: null,
    trailing_silence_ms: null,
    scanned_at: 0,
  }
}

export const ids = (tracks: readonly Track[]) => tracks.map(t => t.id)
