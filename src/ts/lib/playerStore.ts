// ts/lib/playerStore.ts
import { create } from 'zustand'
import type { Track } from './db'

/**
 * UI に公開する再生状態のミラー。
 *
 * ここに値をセットするのは MusicPlayer だけで、コンポーネントからは
 * 「読む」用途のみに使う。操作は musicPlayer.xxx() を直接呼ぶこと。
 *
 * 理由: HTMLAudioElement や fade の setInterval といった命令的リソースは
 * class 側で一元管理されており、store から直接いじると整合性が壊れる。
 */
interface PlayerStore {
  currentTrack: Track | null
  isPlaying: boolean
  positionMs: number
  durationMs: number | null
  queue: Track[]
  volume: number

  // MusicPlayer が内部的に使う setter
  _setCurrentTrack: (t: Track | null) => void
  _setIsPlaying: (v: boolean) => void
  _setPosition: (ms: number) => void
  _setDuration: (ms: number | null) => void
  _setQueue: (q: Track[]) => void
  _setVolume: (v: number) => void
}

export const usePlayerStore = create<PlayerStore>(set => ({
  currentTrack: null,
  isPlaying: false,
  positionMs: 0,
  durationMs: null,
  queue: [],
  volume: 1.0,

  _setCurrentTrack: (t) => set({ currentTrack: t }),
  _setIsPlaying: (v) => set({ isPlaying: v }),
  _setPosition: (ms) => set({ positionMs: ms }),
  _setDuration: (ms) => set({ durationMs: ms }),
  _setQueue: (q) => set({ queue: q }),
  _setVolume: (v) => set({ volume: v }),
}))
