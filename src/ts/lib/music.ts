// ts/lib/music.ts
import { convertFileSrc } from '@tauri-apps/api/core'
import type { Track } from './db'
import { usePlayerStore } from './playerStore'

// ---------------------------------------------------
// 設定（後で設定画面から読むようにする）
// ---------------------------------------------------
const CROSS_SETTINGS = 'cross_fade' // 'normal' | 'cross_fade'
const DEFAULT_VOLUME = 1.0
const CROSSFADE_DURATION_MS = 3000
const DEFAULT_FADEOUT_MS = 500
const FADE_TICK_MS = 20

/**
 * 2つの HTMLAudioElement を交互に使い回すことで
 * クロスフェードを実現する音楽プレイヤー。
 *
 * - active : いま鳴っている Audio
 * - standby: 次の曲を先読みしておく Audio（クロスフェード用）
 *
 * UI に見せる状態（currentTrack / positionMs / queue 等）は
 * usePlayerStore にミラーする。コンポーネントはそちらを購読する。
 */
export class MusicPlayer {
  private audioA: HTMLAudioElement
  private audioB: HTMLAudioElement
  private active: HTMLAudioElement
  private standby: HTMLAudioElement

  private volume: number = DEFAULT_VOLUME
  private currentTrack: Track | null = null
  private queue: Track[] = []

  // 実行中の fade interval を管理して、重複実行時にキャンセルできるようにする
  private fadeTimers: Map<HTMLAudioElement, number> = new Map()

  // active に付けているイベントハンドラ群。差し替え時に remove するために保持
  private activeListeners: {
    ended: () => void
    timeupdate: () => void
    loadedmetadata: () => void
    play: () => void
    pause: () => void
  } | null = null

  constructor() {
    this.audioA = new Audio()
    this.audioB = new Audio()
    this.audioA.preload = 'auto'
    this.audioB.preload = 'auto'
    this.audioA.volume = this.volume
    this.audioB.volume = this.volume

    this.active = this.audioA
    this.standby = this.audioB

    this.attachActiveListeners()
  }

  // ---------------------------------------------------
  // 再生制御
  // ---------------------------------------------------

  /**
   * 指定された曲を再生する。
   * 再生中の場合は CROSS_SETTINGS に応じて挙動が変わる。
   *   - 'cross_fade' : クロスフェードしつつ新しい曲に切り替える
   *   - 'normal'     : 現在の曲を即止めて新しい曲を頭から再生する
   */
  async play(track: Track): Promise<void> {
    const isPlaying = !this.active.paused && !this.active.ended && this.active.src !== ''

    if (isPlaying && CROSS_SETTINGS === 'cross_fade') {
      await this.crossfadeTo(track, CROSSFADE_DURATION_MS)
    } else {
      this.cancelFade(this.active)
      this.cancelFade(this.standby)
      await this.loadInto(this.active, track)
      this.active.volume = this.volume
      await this.active.play()
      this.setCurrentTrack(track)
    }
  }

  /**
   * フェードアウトしつつ停止する。
   * @param duration フェードアウトにかける時間（ミリ秒）
   */
  async stop(duration: number = DEFAULT_FADEOUT_MS): Promise<void> {
    await this.fadeOut(this.active, duration)
    this.active.pause()
    this.active.currentTime = 0
    this.setCurrentTrack(null)
  }

  /**
   * 一時停止 / 再開。停止とは違い、fade はかけない。
   */
  async togglePause(): Promise<void> {
    if (this.active.paused) {
      await this.active.play()
    } else {
      this.active.pause()
    }
  }

  /**
   * 指定した位置にシークする。
   * @param ms ミリ秒
   */
  seek(ms: number): void {
    if (!this.active.duration || isNaN(this.active.duration)) return
    const clamped = Math.max(0, Math.min(this.active.duration * 1000, ms))
    this.active.currentTime = clamped / 1000
    usePlayerStore.getState()._setPosition(clamped)
  }

  // ---------------------------------------------------
  // 音量
  // ---------------------------------------------------

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v))
    // フェード中でなければ即座に反映
    if (!this.fadeTimers.has(this.active)) {
      this.active.volume = this.volume
    }
    usePlayerStore.getState()._setVolume(this.volume)
  }

  // ---------------------------------------------------
  // キュー操作
  //
  // store.queue は常にこのメソッド経由で更新する。
  // 直接 store を書き換えないこと（class の currentTrack と整合しなくなる）。
  // ---------------------------------------------------

  setQueue(tracks: Track[]): void {
    this.queue = [...tracks]
    this.syncQueue()
  }

  enqueue(track: Track): void {
    this.queue.push(track)
    this.syncQueue()
  }

  /**
   * キューの指定位置の曲を削除する。
   * 現在再生中の曲はキューに入っていない扱いなので、stop は呼ばない。
   */
  removeFromQueue(index: number): void {
    if (index < 0 || index >= this.queue.length) return
    this.queue.splice(index, 1)
    this.syncQueue()
  }

  /**
   * キュー内で曲を並び替える（ドラッグ&ドロップ用）。
   */
  moveInQueue(from: number, to: number): void {
    if (from < 0 || from >= this.queue.length) return
    if (to < 0 || to >= this.queue.length) return
    if (from === to) return
    const [moved] = this.queue.splice(from, 1)
    this.queue.splice(to, 0, moved)
    this.syncQueue()
  }

  clearQueue(): void {
    this.queue = []
    this.syncQueue()
  }

  /**
   * キューを読み取る（デバッグ用。UI は usePlayerStore から購読すること）
   */
  getQueue(): readonly Track[] {
    return this.queue
  }

  getCurrentTrack(): Track | null {
    return this.currentTrack
  }

  // ---------------------------------------------------
  // 内部処理
  // ---------------------------------------------------

  private syncQueue(): void {
    usePlayerStore.getState()._setQueue([...this.queue])
  }

  private setCurrentTrack(track: Track | null): void {
    this.currentTrack = track
    const store = usePlayerStore.getState()
    store._setCurrentTrack(track)
    if (track === null) {
      store._setIsPlaying(false)
      store._setPosition(0)
      store._setDuration(null)
    }
  }

  /**
   * active に付けるイベントハンドラをまとめて登録する。
   * swap 時に detach してから新しい active に付け直す。
   */
  private attachActiveListeners(): void {
    const ended = () => {
      this.playNextFromQueue()
    }
    const timeupdate = () => {
      usePlayerStore.getState()._setPosition(this.active.currentTime * 1000)
    }
    const loadedmetadata = () => {
      const d = this.active.duration
      usePlayerStore.getState()._setDuration(
        isNaN(d) || !isFinite(d) ? null : d * 1000
      )
    }
    const onPlay = () => {
      usePlayerStore.getState()._setIsPlaying(true)
    }
    const onPause = () => {
      usePlayerStore.getState()._setIsPlaying(false)
    }

    this.active.addEventListener('ended', ended)
    this.active.addEventListener('timeupdate', timeupdate)
    this.active.addEventListener('loadedmetadata', loadedmetadata)
    this.active.addEventListener('play', onPlay)
    this.active.addEventListener('pause', onPause)

    this.activeListeners = { ended, timeupdate, loadedmetadata, play: onPlay, pause: onPause }
  }

  private detachActiveListeners(): void {
    if (!this.activeListeners) return
    const { ended, timeupdate, loadedmetadata, play, pause } = this.activeListeners
    this.active.removeEventListener('ended', ended)
    this.active.removeEventListener('timeupdate', timeupdate)
    this.active.removeEventListener('loadedmetadata', loadedmetadata)
    this.active.removeEventListener('play', play)
    this.active.removeEventListener('pause', pause)
    this.activeListeners = null
  }

  private async playNextFromQueue(): Promise<void> {
    const next = this.queue.shift()
    this.syncQueue()
    if (!next) {
      this.setCurrentTrack(null)
      return
    }
    this.cancelFade(this.active)
    await this.loadInto(this.active, next)
    this.active.volume = this.volume
    await this.active.play()
    this.setCurrentTrack(next)
  }

  /**
   * standby 側に次の曲をロードし、active と standby の音量を
   * 少しずつ入れ替える形でクロスフェードする。
   * 終わったら active / standby の役割を交換する。
   */
  private async crossfadeTo(track: Track, duration: number): Promise<void> {
    this.cancelFade(this.active)
    this.cancelFade(this.standby)

    await this.loadInto(this.standby, track)
    this.standby.volume = 0
    await this.standby.play()

    const target = this.volume
    const steps = Math.max(1, Math.floor(duration / FADE_TICK_MS))
    const stepDelta = target / steps

    const fadingOut = this.active
    const fadingIn = this.standby

    await new Promise<void>(resolve => {
      let i = 0
      const id = window.setInterval(() => {
        i++
        const nextOut = Math.max(0, target - stepDelta * i)
        const nextIn = Math.min(target, stepDelta * i)
        fadingOut.volume = nextOut
        fadingIn.volume = nextIn
        if (i >= steps) {
          window.clearInterval(id)
          this.fadeTimers.delete(fadingOut)
          this.fadeTimers.delete(fadingIn)
          resolve()
        }
      }, FADE_TICK_MS)
      this.fadeTimers.set(fadingOut, id)
      this.fadeTimers.set(fadingIn, id)
    })

    // 旧 active を停止し、役割を交換
    fadingOut.pause()
    fadingOut.currentTime = 0
    this.swapActive()
    this.setCurrentTrack(track)
  }

  private async fadeOut(el: HTMLAudioElement, duration: number): Promise<void> {
    this.cancelFade(el)
    if (el.paused) return

    const start = el.volume
    if (start <= 0) return

    const steps = Math.max(1, Math.floor(duration / FADE_TICK_MS))
    const stepDelta = start / steps

    await new Promise<void>(resolve => {
      let i = 0
      const id = window.setInterval(() => {
        i++
        el.volume = Math.max(0, start - stepDelta * i)
        if (i >= steps) {
          window.clearInterval(id)
          this.fadeTimers.delete(el)
          resolve()
        }
      }, FADE_TICK_MS)
      this.fadeTimers.set(el, id)
    })
  }

  private cancelFade(el: HTMLAudioElement): void {
    const id = this.fadeTimers.get(el)
    if (id !== undefined) {
      window.clearInterval(id)
      this.fadeTimers.delete(el)
    }
  }

  /**
   * active と standby の指している Audio を入れ替え、
   * イベントハンドラを新しい active に付け替える。
   */
  private swapActive(): void {
    this.detachActiveListeners()
    const tmp = this.active
    this.active = this.standby
    this.standby = tmp
    this.attachActiveListeners()
  }

  /**
   * HTMLAudioElement に Track のローカルパスをセットし、
   * 再生可能になるまで待つ。
   */
  private loadInto(el: HTMLAudioElement, track: Track): Promise<void> {
    return new Promise((resolve, reject) => {
      const onCanPlay = () => {
        el.removeEventListener('canplay', onCanPlay)
        el.removeEventListener('error', onError)
        resolve()
      }
      const onError = () => {
        el.removeEventListener('canplay', onCanPlay)
        el.removeEventListener('error', onError)
        reject(new Error(`Failed to load: ${track.path}`))
      }
      el.addEventListener('canplay', onCanPlay)
      el.addEventListener('error', onError)
      el.src = convertFileSrc(track.path)
      el.load()
    })
  }
}

// アプリ全体で共有する singleton
export const musicPlayer = new MusicPlayer()
