import type { Track } from '../db'
import { usePlayerStore } from '../playerStore'

export interface MusicPlayer {
  play(track: Track): Promise<void>
  stop(): Promise<void>
  togglePause(): Promise<void>
  seek(ms: number): void
  prev(): Promise<void>
  next(): Promise<void>
  setQueue(tracks: Track[]): void
  enqueue(track: Track): void
  removeFromQueue(index: number): void
  moveInQueue(from: number, to: number): void
  clearQueue(): void
  getQueue(): readonly Track[]
  getCurrentTrack(): Track | null
  pushHistory(track: Track): void
  dispose(): void
}

// 末尾の無音を除いた有効再生長 (ms) を返す
// 無音を引いた結果が 0 以下になる場合は全部の時間をそのまま返す
export function trimTrailingSilence(fullMs: number, trim: boolean, track: Track | null): number {
  const silence = trim ? (track?.trailing_silence_ms ?? 0) : 0
  const eff = fullMs - silence
  return eff > 0 ? eff : fullMs
}

// queue / history / currentTrack のローカル状態と、キュー操作の共通部分
// 境界チェック・重複ガード・store への同期はここで一元化し、
// ネイティブ実装は on* フックを上書きして同じ操作をネイティブ側へ転送する。
export abstract class QueuedMusicPlayer implements MusicPlayer {
  protected queue: Track[] = []
  protected history: Track[] = []
  protected currentTrack: Track | null = null

  abstract play(track: Track): Promise<void>
  abstract stop(): Promise<void>
  abstract togglePause(): Promise<void>
  abstract seek(ms: number): void
  abstract prev(): Promise<void>
  abstract next(): Promise<void>
  abstract dispose(): void

  protected syncQueue(): void {
    usePlayerStore.getState()._setQueue([...this.queue])
  }

  setQueue(tracks: Track[]): void {
    this.queue = [...tracks]
    this.syncQueue()
    this.onQueueSet(tracks)
  }

  enqueue(track: Track): void {
    // すでにある曲を enqueue しない
    if (this.currentTrack?.id === track.id) return
    if (this.queue.some(t => t.id === track.id)) return

    this.queue.push(track)
    this.syncQueue()
    this.onEnqueued(track)
  }

  removeFromQueue(index: number): void {
    if (index < 0 || index >= this.queue.length) return
    this.queue.splice(index, 1)
    this.syncQueue()
    this.onRemoved(index)
  }

  moveInQueue(from: number, to: number): void {
    if (from < 0 || from >= this.queue.length) return
    if (to < 0 || to >= this.queue.length) return
    if (from === to) return
    const [moved] = this.queue.splice(from, 1)
    this.queue.splice(to, 0, moved)
    this.syncQueue()
    this.onMoved(from, to)
  }

  clearQueue(): void {
    this.queue = []
    this.syncQueue()
    this.onCleared()
  }

  getQueue(): readonly Track[] { return this.queue }
  getCurrentTrack(): Track | null { return this.currentTrack }
  pushHistory(track: Track): void { this.history.push(track) }

  // ローカル状態の更新後に呼ばれるフック。desktop はローカル状態だけで完結する。
  protected onQueueSet(_tracks: Track[]): void {}
  protected onEnqueued(_track: Track): void {}
  protected onRemoved(_index: number): void {}
  protected onMoved(_from: number, _to: number): void {}
  protected onCleared(): void {}
}
