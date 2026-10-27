import { beforeEach, describe, expect, it, vi } from 'vitest'

// ネイティブから届くイベントをテストから送れるよう、登録されたハンドラを取っておく
let emit: (ev: object) => void = () => {}
const invoke = vi.fn(async (_cmd: string, _args?: object) => undefined)
vi.mock('@tauri-apps/api/core', () => ({
  invoke,
  addPluginListener: async (_plugin: string, _event: string, handler: (ev: object) => void) => {
    emit = handler
    return { unregister: async () => {} }
  },
}))
const startPlay = vi.fn(async (trackId: number) => trackId * 10)
const updateListenedMs = vi.fn(async (_historyId: number, _ms: number) => {})
vi.mock('../db', () => ({ startPlay, updateListenedMs }))

const { NativeAndroidMusicPlayer } = await import('./android')
const { usePlayerStore } = await import('../playerStore')
const { ids, track } = await import('./testTracks')

const trackChanged = (id: number, prevListenedMs?: number) =>
  emit({ type: 'trackChanged', item: { trackId: id, title: '', artist: '' }, durationMs: 180000, prevListenedMs })
const settle = () => new Promise(resolve => setTimeout(resolve, 0))

let player: InstanceType<typeof NativeAndroidMusicPlayer>
const state = () => ({
  current: player.getCurrentTrack()?.id ?? null,
  queue: ids(player.getQueue()),
  store: ids(usePlayerStore.getState().queue),
})

beforeEach(async () => {
  invoke.mockClear()
  startPlay.mockClear()
  updateListenedMs.mockClear()
  player = new NativeAndroidMusicPlayer()
  await settle() // addPluginListener の登録を待つ
  // 1 をクリック → 残りの 2, 3, 4 がキューに入る (playFromList と同じ呼び方)
  player.setQueue([track(2), track(3), track(4)])
  await player.play(track(1))
  trackChanged(1)
})

describe('NativeAndroidMusicPlayer の曲変更イベント', () => {
  it('最初の曲はキューに無くても覚えておいた Track を表示する', () => {
    expect(state()).toEqual({ current: 1, queue: [2, 3, 4], store: [2, 3, 4] })
    expect(usePlayerStore.getState().currentTrack?.id).toBe(1)
  })

  it('前進: 飛ばした曲は履歴に積み、キューから外す', () => {
    trackChanged(3)
    expect(state()).toEqual({ current: 3, queue: [4], store: [4] })
  })

  it('後退: 履歴の途中まで戻すと、戻った分をキューの先頭に返す', () => {
    trackChanged(3)
    trackChanged(1)
    expect(state()).toEqual({ current: 1, queue: [2, 3, 4], store: [2, 3, 4] })
  })

  it('同じ曲の trackChanged は無視する', () => {
    trackChanged(1)
    expect(startPlay).toHaveBeenCalledTimes(1)
    expect(state().queue).toEqual([2, 3, 4])
  })

  it('終わった曲の listened_ms はネイティブの確定値で書く', async () => {
    trackChanged(2, 42000)
    await settle()
    expect(startPlay.mock.calls.map(c => c[0])).toEqual([1, 2])
    expect(updateListenedMs).toHaveBeenCalledWith(10, 42000)
  })

  it('queueEnded で再生中の曲を空にする', () => {
    emit({ type: 'queueEnded', prevListenedMs: 1000 })
    expect(player.getCurrentTrack()).toBeNull()
    expect(usePlayerStore.getState().isPlaying).toBe(false)
  })
})
