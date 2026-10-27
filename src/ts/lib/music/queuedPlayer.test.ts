import { describe, expect, it } from 'vitest'
import type { Track } from '../db'
import { usePlayerStore } from '../playerStore'
import { QueuedMusicPlayer, trimTrailingSilence } from './queuedPlayer'
import { ids, track } from './testTracks'

// フックの呼び出しを記録するだけの実装
class RecordingPlayer extends QueuedMusicPlayer {
  calls: string[] = []
  async play() {}
  async stop() {}
  async togglePause() {}
  seek() {}
  async prev() {}
  async next() {}
  dispose() {}
  setCurrent(t: Track | null) { this.currentTrack = t }
  protected onQueueSet(tracks: Track[]) { this.calls.push(`set ${ids(tracks)}`) }
  protected onEnqueued(t: Track) { this.calls.push(`enqueue ${t.id}`) }
  protected onRemoved(index: number) { this.calls.push(`remove ${index}`) }
  protected onMoved(from: number, to: number) { this.calls.push(`move ${from} ${to}`) }
  protected onCleared() { this.calls.push('clear') }
}

const storeQueue = () => ids(usePlayerStore.getState().queue)

describe('QueuedMusicPlayer', () => {
  it('setQueue は渡した配列をコピーして store にも反映する', () => {
    const p = new RecordingPlayer()
    const input = [track(1), track(2)]
    p.setQueue(input)
    input.push(track(3))
    expect(ids(p.getQueue())).toEqual([1, 2])
    expect(storeQueue()).toEqual([1, 2])
    expect(p.calls).toEqual(['set 1,2'])
  })

  it('enqueue は再生中の曲とキューにある曲を追加しない', () => {
    const p = new RecordingPlayer()
    p.setCurrent(track(1))
    p.setQueue([track(2)])
    p.enqueue(track(1))
    p.enqueue(track(2))
    p.enqueue(track(3))
    expect(ids(p.getQueue())).toEqual([2, 3])
    expect(p.calls).toEqual(['set 2', 'enqueue 3'])
  })

  it('removeFromQueue / moveInQueue は範囲外と同じ位置への移動を無視する', () => {
    const p = new RecordingPlayer()
    p.setQueue([track(1), track(2), track(3)])
    p.removeFromQueue(-1)
    p.removeFromQueue(3)
    p.moveInQueue(0, 3)
    p.moveInQueue(1, 1)
    expect(p.calls).toEqual(['set 1,2,3'])

    p.moveInQueue(0, 2)
    expect(ids(p.getQueue())).toEqual([2, 3, 1])
    p.removeFromQueue(1)
    expect(ids(p.getQueue())).toEqual([2, 1])
    expect(storeQueue()).toEqual([2, 1])
    expect(p.calls.slice(1)).toEqual(['move 0 2', 'remove 1'])
  })

  it('clearQueue はキューを空にする', () => {
    const p = new RecordingPlayer()
    p.setQueue([track(1)])
    p.clearQueue()
    expect(p.getQueue()).toEqual([])
    expect(storeQueue()).toEqual([])
    expect(p.calls).toEqual(['set 1', 'clear'])
  })
})

describe('trimTrailingSilence', () => {
  const withSilence = (ms: number | null) => ({ ...track(1), trailing_silence_ms: ms })

  it('ON のときだけ末尾無音を引く', () => {
    expect(trimTrailingSilence(10000, true, withSilence(2000))).toBe(8000)
    expect(trimTrailingSilence(10000, false, withSilence(2000))).toBe(10000)
    expect(trimTrailingSilence(10000, true, withSilence(null))).toBe(10000)
  })

  it('引いた結果が 0 以下なら実尺を返す', () => {
    expect(trimTrailingSilence(1000, true, withSilence(1000))).toBe(1000)
  })
})
