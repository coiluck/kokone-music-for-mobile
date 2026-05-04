// ts/lib/music.ts
import { invoke } from '@tauri-apps/api/core'
import { type Track, musicPlay } from './db'
import { usePlayerStore } from './playerStore'
import { useSettingsStore } from './settingsStore'

const TARGET_LUFS = -14.0
const NORM_TIME_CONSTANT_SEC = 0.05
const POSITION_POLL_MS = 200

const MIME_BY_EXT: Record<string, string> = {
  mp3: 'audio/mpeg',
  flac: 'audio/flac',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  wav: 'audio/wav',
}

function mimeForPath(path: string): string {
  const dot = path.lastIndexOf('.')
  if (dot < 0) return 'application/octet-stream'
  const ext = path.slice(dot + 1).toLowerCase()
  return MIME_BY_EXT[ext] ?? 'application/octet-stream'
}

/**
 * HTMLAudioElement を Blob URL 経由で駆動する音楽プレイヤー。
 *
 *   MediaElementSource → normGain → fadeGain → masterGain → destination
 *
 * - normGain : Track の LUFS を見て -14 LUFS にそろえる音量補正 (>1 もありうる)
 * - fadeGain : 停止フェード用の 0〜1 のエンベロープ
 * - masterGain: ユーザー音量 (0〜1)
 *
 * Tauri Android の WebView 〜 Tauri 間 Range 通信バグ (issue #12019) のせいで
 * convertFileSrc / asset protocol / 自前 custom protocol いずれを使っても
 * 30 秒前後で再生が停止する。回避のため、Rust 側で Vec<u8> として読み出した
 * ファイル全体を Blob にして URL.createObjectURL で Blob URL を作り、
 * audio.src にセットする。Blob URL は WebView 内部で完結するので
 * Tauri の HTTP プロキシを経由せず、Range バグの影響を受けない。
 *
 * MediaElementAudioSourceNode は同じ audio 要素に対して 1 回しか作れない
 * 制約のため、audio 要素 / source ノード / デッキは全て使い回す。
 *
 * クロスフェードは廃止 (常に即切り替え)。
 *
 * UI に見せる状態は usePlayerStore にミラーする。
 *
 * queue は「これから流れる曲」、history は「これまでに流れた曲」。
 * next() は queue の先頭を取り出し、現曲を history に積む。
 * prev() は history から戻り、現曲を queue の先頭に戻す。
 */
export class MusicPlayer {
  private ctx: AudioContext
  private masterGain: GainNode

  private active: Deck

  private currentTrack: Track | null = null
  private queue: Track[] = []
  private history: Track[] = []
  private currentBlobUrl: string | null = null

  // useSettingsStore から購読した再生設定
  private masterVolume: number
  private isNormalizeVolume: boolean
  private fadeoutMs: number
  private isTrailingSilence: boolean
  private unsubscribeSettings: () => void

  private positionPollId: ReturnType<typeof setInterval> | null = null

  constructor() {
    this.ctx = new AudioContext()
    this.masterGain = this.ctx.createGain()

    const s = useSettingsStore.getState()
    this.masterVolume = s.masterVolume
    this.isNormalizeVolume = s.isNormalizeVolume
    this.fadeoutMs = s.fadeoutMs
    this.isTrailingSilence = s.isTrailingSilence

    this.masterGain.gain.value = this.masterVolume
    this.masterGain.connect(this.ctx.destination)

    this.active = this.createDeck()

    this.startPositionPoll()

    this.unsubscribeSettings = useSettingsStore.subscribe((state, prev) => {
      if (state.masterVolume !== prev.masterVolume) {
        this.masterVolume = state.masterVolume
        this.masterGain.gain.setTargetAtTime(
          this.masterVolume,
          this.ctx.currentTime,
          NORM_TIME_CONSTANT_SEC
        )
      }
      if (state.isNormalizeVolume !== prev.isNormalizeVolume) {
        this.isNormalizeVolume = state.isNormalizeVolume
        this.applyLufsGain(this.active, this.currentTrack?.lufs ?? null)
      }
      if (state.fadeoutMs !== prev.fadeoutMs) {
        this.fadeoutMs = state.fadeoutMs
      }
      if (state.isTrailingSilence !== prev.isTrailingSilence) {
        this.isTrailingSilence = state.isTrailingSilence
      }
    })
  }

  /**
   * 破棄時にリソースを解放する。
   */
  dispose(): void {
    this.unsubscribeSettings()
    this.stopPositionPoll()
    try { this.active.audio.pause() } catch { /* ignore */ }
    this.active.audio.removeAttribute('src')
    this.active.audio.load()
    if (this.currentBlobUrl) {
      URL.revokeObjectURL(this.currentBlobUrl)
      this.currentBlobUrl = null
    }
  }

  // ---------------------------------------------------
  // 再生制御
  // ---------------------------------------------------

  /**
   * 指定された曲を再生する。
   *   - 既に同じ曲が再生中なら何もしない（早期 return）
   *   - それ以外は即座に切り替え
   */
  async play(track: Track): Promise<void> {
    if (this.currentTrack?.id === track.id && !this.active.audio.paused) {
      return
    }

    if (this.ctx.state !== 'running') {
      await this.ctx.resume()
    }

    this.cancelFade(this.active)
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
      console.error('[MusicPlayer] audio.play failed:', e)
      return
    }
    this.setCurrentTrack(track)
  }

  /**
   * フェードアウトしつつ停止する。
   */
  async stop(duration?: number): Promise<void> {
    await this.fadeOut(this.active, duration ?? this.fadeoutMs)
    this.active.audio.pause()
    this.setCurrentTrack(null)
  }

  // 一時停止 / 再開。fade はかけない
  async togglePause(): Promise<void> {
    if (!this.currentTrack) return
    if (this.active.audio.paused) {
      if (this.ctx.state !== 'running') {
        await this.ctx.resume()
      }
      try {
        await this.active.audio.play()
      } catch (e) {
        console.error('[MusicPlayer] audio.play failed:', e)
        return
      }
      usePlayerStore.getState()._setIsPlaying(true)
    } else {
      this.active.audio.pause()
      usePlayerStore.getState()._setIsPlaying(false)
    }
  }

  // 指定した位置にシークする
  seek(ms: number): void {
    if (!this.active.durationSec) return
    const sec = Math.max(0, Math.min(this.active.durationSec, ms / 1000))
    this.active.audio.currentTime = sec
    usePlayerStore.getState()._setPosition(sec * 1000)
  }

  /**
   * 前の曲に戻る。
   * - 現曲の再生位置が 3 秒以上なら、まず曲頭に戻す
   * - それ未満なら history から一つ戻す
   * - history が空なら曲頭に戻すだけ
   */
  async prev(): Promise<void> {
    if (this.getActivePositionSec() > 3) {
      this.seek(0)
      return
    }
    const prevTrack = this.history.pop()
    if (!prevTrack) {
      this.seek(0)
      return
    }
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

  // queue の処理で使用
  pushHistory(track: Track): void {
    this.history.push(track)
  }

  // ---------------------------------------------------
  // 内部処理
  // ---------------------------------------------------

  /**
   * デッキを 1 つ作る。MediaElementSource は同じ audio 要素に対して
   * 一度しか作れないため、このメソッドは MusicPlayer のライフタイム中に
   * 1 度しか呼ばれず、生成された audio / source / gain ノードは使い回す。
   */
  private createDeck(): Deck {
    const audio = new Audio()
    audio.preload = 'auto'

    const source = this.ctx.createMediaElementSource(audio)
    const normGain = this.ctx.createGain()
    const fadeGain = this.ctx.createGain()
    normGain.gain.value = 1.0
    fadeGain.gain.value = 1.0

    source.connect(normGain)
    normGain.connect(fadeGain)
    fadeGain.connect(this.masterGain)

    const deck: Deck = {
      audio,
      source,
      normGain,
      fadeGain,
      durationSec: 0,
    }

    audio.addEventListener('ended', () => {
      this.onActiveEnded().catch(e => {
        console.error('[MusicPlayer] onActiveEnded failed:', e)
      })
    })

    return deck
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
    } else {
      store._setIsPlaying(true)
      store._setDuration(this.active.durationSec * 1000)
      store._setPosition(0)
      musicPlay(track.id).catch(e => console.error('[MusicPlayer] musicPlay failed:', e))
    }
  }

  private getActivePositionSec(): number {
    return this.active.audio.currentTime
  }

  private startPositionPoll(): void {
    if (this.positionPollId !== null) return
    this.positionPollId = setInterval(() => {
      if (this.active.audio.paused) return
      const sec = this.active.audio.currentTime
      const clamped = Math.max(0, Math.min(this.active.durationSec, sec))
      usePlayerStore.getState()._setPosition(clamped * 1000)
    }, POSITION_POLL_MS)
  }

  private stopPositionPoll(): void {
    if (this.positionPollId !== null) {
      clearInterval(this.positionPollId)
      this.positionPollId = null
    }
  }

  /**
   * active の曲が自然に終端に達したときの処理。history に積んで次の曲へ。
   */
  private async onActiveEnded(): Promise<void> {
    usePlayerStore.getState()._setIsPlaying(false)
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
      console.error('[MusicPlayer] audio.play failed:', e)
      return
    }
    this.setCurrentTrack(nextTrack)
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
    const gain = !this.isNormalizeVolume
      ? 1.0
      : trackLufs != null && isFinite(trackLufs)
        ? Math.pow(10, (TARGET_LUFS - trackLufs) / 20)
        : 1.0
    deck.normGain.gain.setTargetAtTime(
      gain,
      this.ctx.currentTime,
      NORM_TIME_CONSTANT_SEC
    )
  }

  /**
   * トラックのファイル全体を Rust 側から Vec<u8> として受け取り、
   * Blob → ObjectURL → audio.src の順で WebView 内部に閉じた URL で
   * 食わせる。Tauri の HTTP プロキシを経由しないため Android の Range
   * バグ (#12019) を回避できる。再生開始は呼び出し側で audio.play() する。
   */
  private async loadInto(deck: Deck, track: Track): Promise<void> {
    // 古い Blob URL を解放してから新しい src をセットする。
    if (this.currentBlobUrl) {
      URL.revokeObjectURL(this.currentBlobUrl)
      this.currentBlobUrl = null
    }

    let buf: ArrayBuffer
    try {
      const t0 = performance.now()
      const result = await invoke<ArrayBuffer | Uint8Array | number[]>(
        'music_read_file',
        { trackId: track.id }
      )
      const tMs = (performance.now() - t0).toFixed(0)

      if (result instanceof ArrayBuffer) {
        buf = result
      } else if (ArrayBuffer.isView(result)) {
        const v = result as Uint8Array
        buf = v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength) as ArrayBuffer
      } else if (Array.isArray(result)) {
        // 旧 Vec<u8> 経路 (JSON の number 配列)。Rust が再ビルドされていない
        // とここを通る。Blob([number[]]) は "10,20,..." の文字列に化けるので
        // 必ず Uint8Array 経由でバイナリに戻す。
        console.warn(
          '[loadInto] received number[] (slow JSON path) — restart `tauri dev` to pick up the binary Response'
        )
        buf = new Uint8Array(result).buffer as ArrayBuffer
      } else {
        throw new Error('unexpected music_read_file response type')
      }

      console.log(`[loadInto] invoke: ${tMs}ms, size: ${buf.byteLength}`)
    } catch (e) {
      throw new Error(`music_read_file failed: ${String(e)}`)
    }

    const mime = mimeForPath(track.path)
    const blob = new Blob([buf], { type: mime })
    const url = URL.createObjectURL(blob)
    this.currentBlobUrl = url

    await new Promise<void>((resolve, reject) => {
      const onCanPlay = () => {
        deck.audio.removeEventListener('error', onError)
        resolve()
      }
      const onError = () => {
        deck.audio.removeEventListener('canplay', onCanPlay)
        const err = deck.audio.error
        reject(new Error(`audio error: code=${err?.code ?? 'unknown'} ${err?.message ?? ''}`))
      }
      deck.audio.addEventListener('canplay', onCanPlay, { once: true })
      deck.audio.addEventListener('error', onError, { once: true })
      deck.audio.src = url
      deck.audio.load()
    })

    deck.durationSec = isFinite(deck.audio.duration) ? deck.audio.duration : 0
  }
}

/**
 * 1 曲分の再生経路をまとめた構造体。
 * MediaElementSource の一度きり制約のため、フィールドはすべて使い回し対象。
 */
interface Deck {
  audio: HTMLAudioElement
  source: MediaElementAudioSourceNode
  normGain: GainNode
  fadeGain: GainNode
  durationSec: number  // audio.duration を最後に観測した値
}

// アプリ全体で共有する singleton
export const musicPlayer = new MusicPlayer()
