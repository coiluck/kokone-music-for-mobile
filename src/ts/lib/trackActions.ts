import type { Track } from './db'
import { musicPlayer } from './music'
import { useTrackStore } from './trackStore'

// Fisher-Yates
export function shuffle<T>(items: readonly T[]): T[] {
  const result = [...items]
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}

// trackIdからstoreのTrackを取得
function toTracks(trackIds: readonly number[]): Track[] {
  const byId = useTrackStore.getState().tracksById
  return trackIds.map(id => byId[id]).filter((t): t is Track => Boolean(t))
}

// リストの中の1曲をクリックして再生
// クリックした曲の次以降 -> リスト先頭からクリックした曲の手前まで
export function playFromList(trackIds: readonly number[], trackId: number): void {
  const track = useTrackStore.getState().tracksById[trackId]
  if (!track) return

  const i = trackIds.indexOf(trackId)

  if (i === -1) {
    void musicPlayer.play(track)
    return
  }

  musicPlayer.setQueue(toTracks([...trackIds.slice(i + 1), ...trackIds.slice(0, i)]))
  void musicPlayer.play(track)
}

// 先頭を再生し、残りを queue に積む。
function playTracks(tracks: Track[]): void {
  if (tracks.length === 0) return
  const [first, ...rest] = tracks
  musicPlayer.setQueue(rest)
  void musicPlayer.play(first)
}

export function playAll(trackIds: readonly number[]): void {
  playTracks(toTracks(trackIds))
}

export function shufflePlay(trackIds: readonly number[]): void {
  playTracks(toTracks(shuffle(trackIds)))
}
