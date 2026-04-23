// ts/lib/music.ts
import { convertFileSrc } from '@tauri-apps/api/core'
import type { Track } from './db'
import { usePlayerStore } from './playerStore'

// ---------------------------------------------------
// 設定（後で設定画面から読むようにする）
// ---------------------------------------------------
const CROSS_SETTINGS: 'normal' | 'cross_fade' = 'cross_fade'
const DEFAULT_VOLUME = 1.0
const CROSSFADE_DURATION_MS = 3000
const DEFAULT_FADEOUT_MS = 500

// ラウドネス正規化のターゲット (LUFS)
const TARGET_LUFS = -14.0
// setTargetAtTime の時定数。LUFS が切り替わる際にプチっと鳴らないよう緩やかに追従させる
const NORM_TIME_CONSTANT_SEC = 0.05

/**
 * 2つの Audio デッキを交互に使い回すことでクロスフェードを実現する音楽プレイヤー。
 *
 *   source → normGain → fadeGain → masterGain → destination
 *
 * - normGain : Track の LUFS を見て -14 LUFS にそろえる音量補正 (>1 もありうる)
 * - fadeGain : クロスフェード / フェードアウト用の 0〜1 のエンベロープ
 * - masterGain: ユーザー音量 (0〜1)
 *
 * active / standby の 2 デッキを交互に使う。
 * UI に見せる状態は usePlayerStore にミラーする。
 *
 * queue は「これから流れる曲」、history は「これまでに流れた曲」。
 * next() は queue の先頭を取り出し、現曲を history に積む。
 * prev() は history から戻り、現曲を queue の先頭に戻す。
 */
export class MusicPlayer {
  private ctx: AudioContext
  private masterGain: GainNode

  private deckA: Deck
  private deckB: Deck
  private active: Deck
  private standby: Deck

  private volume: number = DEFAULT_VOLUME
  private currentTrack: Track | null = null
  private queue: Track[] = []
  private history: Track[] = []

  // active 側の audio 要素に付けているリスナー。swap 時に付け替える
  private activeListeners: {
    ended: () => void
    timeupdate: () => void
    loadedmetadata: () => void
    play: () => void
    pause: () => void
  } | null = null

  constructor() {
    this.ctx = new AudioContext()
    this.masterGain = this.ctx.createGain()
    this.masterGain.gain.value = this.volume
    this.masterGain.connect(this.ctx.destination)

    this.deckA = this.createDeck()
    this.deckB = this.createDeck()

    this.active = this.deckA
    this.standby = this.deckB

    this.attachActiveListeners()
  }

  // ---------------------------------------------------
  // 再生制御
  // ---------------------------------------------------

  /**
   * 指定された曲を再生する。
   *   - 既に同じ曲が再生中なら何もしない（早期 return）
   *   - 何か再生中 + cross_fade 設定ならクロスフェード
   *   - それ以外は即座に切り替え
   */
  async play(track: Track): Promise<void> {
    // 同じ曲を連打された場合は何もしない
    if (
      this.currentTrack?.id === track.id &&
      !this.active.audio.paused &&
      !this.active.audio.ended
    ) {
      return
    }

    const isPlaying =
      !this.active.audio.paused &&
      !this.active.audio.ended &&
      this.active.audio.src !== ''

    if (isPlaying && CROSS_SETTINGS === 'cross_fade') {
      await this.crossfadeTo(track, CROSSFADE_DURATION_MS)
    } else {
      this.cancelFade(this.active)
      this.cancelFade(this.standby)
      try {
        await this.loadInto(this.active, track)
      } catch (e) {
        console.error('[MusicPlayer] loadInto failed:', e)
        return
      }
      this.applyLufsGain(this.active, track.lufs ?? null)
      this.active.fadeGain.gain.cancelScheduledValues(this.ctx.currentTime)
      this.active.fadeGain.gain.setValueAtTime(1, this.ctx.currentTime)
      try {
        await this.active.audio.play()
      } catch (e) {
        console.error('[MusicPlayer] audio.play() failed:', e)
        return
      }
      this.setCurrentTrack(track)
    }
  }

  /**
   * フェードアウトしつつ停止する。
   */
  async stop(duration: number = DEFAULT_FADEOUT_MS): Promise<void> {
    await this.fadeOut(this.active, duration)
    this.active.audio.pause()
    this.active.audio.currentTime = 0
    this.setCurrentTrack(null)
  }

  // 一時停止 / 再開。fade はかけない
  async togglePause(): Promise<void> {
    if (this.active.audio.paused) {
      try {
        await this.active.audio.play()
      } catch (e) {
        console.error('[MusicPlayer] audio.play() failed:', e)
      }
    } else {
      this.active.audio.pause()
    }
  }

  // 指定した位置にシークする
  seek(ms: number): void {
    const dur = this.active.audio.duration
    if (!dur || isNaN(dur)) return
    const clamped = Math.max(0, Math.min(dur * 1000, ms))
    this.active.audio.currentTime = clamped / 1000
    usePlayerStore.getState()._setPosition(clamped)
  }

  /**
   * 前の曲に戻る。
   * - 現曲の再生位置が 3 秒以上なら、まず曲頭に戻す
   * - それ未満なら history から一つ戻す
   * - history が空なら曲頭に戻すだけ
   */
  async prev(): Promise<void> {
    if (this.active.audio.currentTime > 3) {
      this.seek(0)
      return
    }
    const prevTrack = this.history.pop()
    if (!prevTrack) {
      this.seek(0)
      return
    }
    // 現曲を queue の先頭に戻す（next() で取り出せるように）
    if (this.currentTrack) {
      this.queue.unshift(this.currentTrack)
      this.syncQueue()
    }
    await this.play(prevTrack)
  }

  /**
   * 次の曲に進む。
   * - queue が空ならフェードアウトして停止
   */
  async next(): Promise<void> {
    const nextTrack = this.queue.shift()
    this.syncQueue()
    if (!nextTrack) {
      await this.stop()
      return
    }
    if (this.currentTrack) {
      this.history.push(this.currentTrack)
    }
    await this.play(nextTrack)
  }

  // ---------------------------------------------------
  // 音量
  // ---------------------------------------------------

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v))
    this.masterGain.gain.setTargetAtTime(
      this.volume,
      this.ctx.currentTime,
      NORM_TIME_CONSTANT_SEC
    )
    usePlayerStore.getState()._setVolume(this.volume)
  }

  // ---------------------------------------------------
  // キュー操作
  //
  // store.queue は常にこのメソッド経由で更新する。
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

  /**
   * 新しいデッキを1つ作る。audio 要素と Web Audio のノードをつないで返す。
   */
  private createDeck(): Deck {
    const audio = new Audio()
    audio.preload = 'auto'
    audio.crossOrigin = 'anonymous'

    const source = this.ctx.createMediaElementSource(audio)
    const normGain = this.ctx.createGain()
    const fadeGain = this.ctx.createGain()
    normGain.gain.value = 1.0
    fadeGain.gain.value = 0.0

    source.connect(normGain)
    normGain.connect(fadeGain)
    fadeGain.connect(this.masterGain)

    return { audio, source, normGain, fadeGain }
  }

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
   * active の audio 要素にイベントハンドラを付ける。swap 時に detach してから付け直す。
   */
  private attachActiveListeners(): void {
    const audio = this.active.audio
    const ended = () => {
      this.onActiveEnded()
    }
    const timeupdate = () => {
      usePlayerStore.getState()._setPosition(audio.currentTime * 1000)
    }
    const loadedmetadata = () => {
      const d = audio.duration
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

    audio.addEventListener('ended', ended)
    audio.addEventListener('timeupdate', timeupdate)
    audio.addEventListener('loadedmetadata', loadedmetadata)
    audio.addEventListener('play', onPlay)
    audio.addEventListener('pause', onPause)

    this.activeListeners = {
      ended,
      timeupdate,
      loadedmetadata,
      play: onPlay,
      pause: onPause,
    }
  }

  private detachActiveListeners(): void {
    if (!this.activeListeners) return
    const audio = this.active.audio
    const { ended, timeupdate, loadedmetadata, play, pause } =
      this.activeListeners
    audio.removeEventListener('ended', ended)
    audio.removeEventListener('timeupdate', timeupdate)
    audio.removeEventListener('loadedmetadata', loadedmetadata)
    audio.removeEventListener('play', play)
    audio.removeEventListener('pause', pause)
    this.activeListeners = null
  }

  /**
   * active の曲が自然に終端に達したときの処理。history に積んで次の曲へ。
   */
  private async onActiveEnded(): Promise<void> {
    if (this.currentTrack) {
      this.history.push(this.currentTrack)
    }
    const nextTrack = this.queue.shift()
    this.syncQueue()
    if (!nextTrack) {
      this.setCurrentTrack(null)
      return
    }
    this.cancelFade(this.active)
    try {
      await this.loadInto(this.active, nextTrack)
    } catch (e) {
      console.error('[MusicPlayer] loadInto failed:', e)
      return
    }
    this.applyLufsGain(this.active, nextTrack.lufs ?? null)
    this.active.fadeGain.gain.cancelScheduledValues(this.ctx.currentTime)
    this.active.fadeGain.gain.setValueAtTime(1, this.ctx.currentTime)
    try {
      await this.active.audio.play()
    } catch (e) {
      console.error('[MusicPlayer] audio.play() failed:', e)
      return
    }
    this.setCurrentTrack(nextTrack)
  }

  /**
   * standby 側に次の曲をロードし、active と standby の fadeGain を
   * linearRampToValueAtTime でクロスフェードする。
   * 終わったら active / standby の役割を交換する。
   */
  private async crossfadeTo(track: Track, durationMs: number): Promise<void> {
    this.cancelFade(this.active)
    this.cancelFade(this.standby)

    try {
      await this.loadInto(this.standby, track)
    } catch (e) {
      console.error('[MusicPlayer] loadInto failed:', e)
      return
    }
    this.applyLufsGain(this.standby, track.lufs ?? null)

    const now = this.ctx.currentTime
    const dur = durationMs / 1000

    // standby は 0 から鳴らし始める
    this.standby.fadeGain.gain.cancelScheduledValues(now)
    this.standby.fadeGain.gain.setValueAtTime(0, now)
    try {
      await this.standby.audio.play()
    } catch (e) {
      console.error('[MusicPlayer] audio.play() failed:', e)
      return
    }

    // ランプをスケジュール
    const outG = this.active.fadeGain.gain
    const inG = this.standby.fadeGain.gain
    outG.cancelScheduledValues(now)
    outG.setValueAtTime(outG.value, now)
    outG.linearRampToValueAtTime(0, now + dur)

    inG.setValueAtTime(0, now)
    inG.linearRampToValueAtTime(1, now + dur)

    // 自然終端と同じ扱いにするため history に積む
    if (this.currentTrack) {
      this.history.push(this.currentTrack)
    }

    // ランプ終了を待つ
    await new Promise<void>(resolve => setTimeout(resolve, durationMs))

    // 旧 active を止めて、役割を交換
    const oldActive = this.active
    oldActive.audio.pause()
    oldActive.audio.currentTime = 0
    this.swapActive()
    this.setCurrentTrack(track)
  }

  /**
   * 指定したデッキをフェードアウトして止める（停止は呼び出し側の責任）
   */
  private async fadeOut(deck: Deck, durationMs: number): Promise<void> {
    this.cancelFade(deck)
    if (deck.audio.paused) return

    const now = this.ctx.currentTime
    const dur = durationMs / 1000
    const g = deck.fadeGain.gain
    g.cancelScheduledValues(now)
    g.setValueAtTime(g.value, now)
    g.linearRampToValueAtTime(0, now + dur)

    await new Promise<void>(resolve => setTimeout(resolve, durationMs))
  }

  /**
   * 予約済みの fadeGain のランプをキャンセルして現在値で固定する。
   */
  private cancelFade(deck: Deck): void {
    const now = this.ctx.currentTime
    const g = deck.fadeGain.gain
    const current = g.value
    g.cancelScheduledValues(now)
    g.setValueAtTime(current, now)
  }

  /**
   * トラックの LUFS から正規化 gain を計算し、normGain に反映する。
   */
  private applyLufsGain(deck: Deck, trackLufs: number | null): void {
    const gain =
      trackLufs != null && isFinite(trackLufs)
        ? Math.pow(10, (TARGET_LUFS - trackLufs) / 20)
        : 1.0
    deck.normGain.gain.setTargetAtTime(
      gain,
      this.ctx.currentTime,
      NORM_TIME_CONSTANT_SEC
    )
  }

  /**
   * active と standby のデッキを入れ替え、リスナーを新しい active に付け替える。
   */
  private swapActive(): void {
    this.detachActiveListeners()
    const tmp = this.active
    this.active = this.standby
    this.standby = tmp
    this.attachActiveListeners()
  }

  /**
   * Track のローカルパスをデッキの audio にセットし、再生可能になるまで待つ。
   * 連続呼び出しでリスナーがリークしないよう once で付ける。
   */
  private loadInto(deck: Deck, track: Track): Promise<void> {
    const el = deck.audio
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        el.removeEventListener('canplay', onCanPlay)
        el.removeEventListener('error', onError)
      }
      const onCanPlay = () => {
        cleanup()
        resolve()
      }
      const onError = () => {
        cleanup()
        reject(
          new Error(
            `Failed to load: ${track.path} (code: ${el.error?.code ?? 'unknown'})`
          )
        )
      }
      el.addEventListener('canplay', onCanPlay, { once: true })
      el.addEventListener('error', onError, { once: true })
      el.src = convertFileSrc(track.path)
      el.load()
    })
  }
}

/**
 * 1 曲分の再生経路をまとめた構造体。
 */
interface Deck {
  audio: HTMLAudioElement
  source: MediaElementAudioSourceNode
  normGain: GainNode
  fadeGain: GainNode
}

// アプリ全体で共有する singleton
export const musicPlayer = new MusicPlayer()