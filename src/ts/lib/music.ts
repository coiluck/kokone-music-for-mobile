// ts/lib/music.ts
import { invoke } from '@tauri-apps/api/core'
import { type Track, musicPlay } from './db'
import { usePlayerStore } from './playerStore'
import { useSettingsStore } from './settingsStore'

const CROSSFADE_DURATION_MS = 1500
const TARGET_LUFS = -14.0
const NORM_TIME_CONSTANT_SEC = 0.05
const POSITION_POLL_MS = 200

/**
 * 2つのデッキを交互に使い回すことでクロスフェードを実現する音楽プレイヤー。
 *
 *   AudioBufferSourceNode → normGain → fadeGain → masterGain → destination
 *
 * - normGain : Track の LUFS を見て -14 LUFS にそろえる音量補正 (>1 もありうる)
 * - fadeGain : クロスフェード / フェードアウト用の 0〜1 のエンベロープ
 * - masterGain: ユーザー音量 (0〜1)
 *
 * Tauri Android の WebView 〜 Tauri 間 Range 通信バグ (issue #12019) のせいで
 * HTMLAudioElement / asset protocol / 自前 custom protocol いずれを使っても
 * 30 秒前後で再生が停止する。回避のため、Rust 側で Vec<u8> として読み出した
 * ファイル全体を AudioContext.decodeAudioData() でデコードし、
 * WebView の HTTP 配信を一切経由しない Web Audio オンリーの経路で再生する。
 *
 * トレードオフ:
 *   - 1 曲分の PCM をメモリに展開するので数十MB消費する (クロスフェード時は2曲分)
 *   - ロード時に 1〜3 秒程度の decode 時間がかかる
 *   - HTMLAudioElement の timeupdate / ended が使えないので自前管理する
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

  private deckA: Deck
  private deckB: Deck
  private active: Deck
  private standby: Deck

  private currentTrack: Track | null = null
  private queue: Track[] = []
  private history: Track[] = []

  // useSettingsStore から購読した再生設定
  private masterVolume: number
  private isNormalizeVolume: boolean
  private crossfadeMode: 'normal' | 'cross_fade'
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
    this.crossfadeMode = s.crossfadeMode
    this.fadeoutMs = s.fadeoutMs
    this.isTrailingSilence = s.isTrailingSilence

    this.masterGain.gain.value = this.masterVolume
    this.masterGain.connect(this.ctx.destination)

    this.deckA = this.createDeck()
    this.deckB = this.createDeck()

    this.active = this.deckA
    this.standby = this.deckB

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
      if (state.crossfadeMode !== prev.crossfadeMode) {
        this.crossfadeMode = state.crossfadeMode
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
    this.stopSource(this.active)
    this.stopSource(this.standby)
    this.releaseBuffer(this.active)
    this.releaseBuffer(this.standby)
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
    if (this.currentTrack?.id === track.id && this.active.isPlaying) {
      return
    }

    if (this.ctx.state !== 'running') {
      await this.ctx.resume()
    }

    if (this.active.isPlaying && this.crossfadeMode === 'cross_fade') {
      await this.crossfadeTo(track, CROSSFADE_DURATION_MS)
    } else {
      this.cancelFade(this.active)
      this.cancelFade(this.standby)
      this.stopSource(this.active)
      try {
        await this.loadInto(this.active, track)
      } catch (e) {
        console.error('[MusicPlayer] loadInto failed:', e)
        return
      }
      this.applyLufsGain(this.active, track.lufs ?? null)
      this.active.fadeGain.gain.cancelScheduledValues(this.ctx.currentTime)
      this.active.fadeGain.gain.setValueAtTime(1, this.ctx.currentTime)
      this.startSource(this.active, 0)
      this.setCurrentTrack(track)
    }
  }

  /**
   * フェードアウトしつつ停止する。
   */
  async stop(duration?: number): Promise<void> {
    await this.fadeOut(this.active, duration ?? this.fadeoutMs)
    this.stopSource(this.active)
    this.releaseBuffer(this.active)
    this.setCurrentTrack(null)
  }

  // 一時停止 / 再開。fade はかけない
  async togglePause(): Promise<void> {
    if (!this.active.buffer) return
    if (this.active.isPlaying) {
      const elapsed = this.ctx.currentTime - this.active.startedAtCtxTime
      this.active.pausedAtSec = Math.max(
        0,
        Math.min(this.active.durationSec, elapsed)
      )
      this.stopSource(this.active)
      usePlayerStore.getState()._setIsPlaying(false)
    } else {
      if (this.ctx.state !== 'running') {
        await this.ctx.resume()
      }
      this.startSource(this.active, this.active.pausedAtSec)
      usePlayerStore.getState()._setIsPlaying(true)
    }
  }

  // 指定した位置にシークする
  seek(ms: number): void {
    if (!this.active.buffer) return
    const dur = this.active.durationSec
    const sec = Math.max(0, Math.min(dur, ms / 1000))
    if (this.active.isPlaying) {
      this.startSource(this.active, sec)
    } else {
      this.active.pausedAtSec = sec
    }
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

  // ---------------------------------------------------
  // 内部処理
  // ---------------------------------------------------

  /**
   * 新しいデッキを1つ作る。BufferSource は再生のたびに作り直すので
   * ここでは normGain と fadeGain だけ用意する。
   */
  private createDeck(): Deck {
    const normGain = this.ctx.createGain()
    const fadeGain = this.ctx.createGain()
    normGain.gain.value = 1.0
    fadeGain.gain.value = 0.0

    normGain.connect(fadeGain)
    fadeGain.connect(this.masterGain)

    return {
      source: null,
      buffer: null,
      normGain,
      fadeGain,
      startedAtCtxTime: 0,
      pausedAtSec: 0,
      isPlaying: false,
      durationSec: 0,
      endedHandled: false,
    }
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
    if (this.active.isPlaying) {
      const sec = this.ctx.currentTime - this.active.startedAtCtxTime
      return Math.max(0, Math.min(this.active.durationSec, sec))
    }
    return this.active.pausedAtSec
  }

  private startPositionPoll(): void {
    if (this.positionPollId !== null) return
    this.positionPollId = setInterval(() => {
      if (!this.active.isPlaying) return
      const sec = this.ctx.currentTime - this.active.startedAtCtxTime
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
   * 新しい BufferSource を作って指定 offset から再生開始する。
   * 既存の source があれば破棄する。
   * AudioBufferSourceNode は一度 stop すると再利用不可なので、
   * 再生 / シーク / pause→resume のたびにこれを呼ぶ。
   */
  private startSource(deck: Deck, offsetSec: number): void {
    if (!deck.buffer) return

    if (deck.source) {
      this.stopSource(deck)
    }

    const src = this.ctx.createBufferSource()
    src.buffer = deck.buffer
    src.connect(deck.normGain)

    deck.endedHandled = false
    src.onended = () => {
      // stop() で意図的に止めたとき or 既に新しい source に置き換わったときは無視
      if (deck.source !== src) return
      if (deck.endedHandled) return
      deck.isPlaying = false
      deck.pausedAtSec = deck.durationSec
      if (deck === this.active) {
        this.onActiveEnded().catch(e => {
          console.error('[MusicPlayer] onActiveEnded failed:', e)
        })
      }
    }

    src.start(0, offsetSec)
    deck.source = src
    deck.startedAtCtxTime = this.ctx.currentTime - offsetSec
    deck.isPlaying = true
  }

  /**
   * 走っている source を意図的に止める。onended の自然終端ハンドラは走らない。
   */
  private stopSource(deck: Deck): void {
    if (!deck.source) return
    deck.endedHandled = true
    try { deck.source.stop() } catch { /* already stopped */ }
    try { deck.source.disconnect() } catch { /* already disconnected */ }
    deck.source = null
    deck.isPlaying = false
  }

  private releaseBuffer(deck: Deck): void {
    deck.buffer = null
    deck.durationSec = 0
    deck.pausedAtSec = 0
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
      this.releaseBuffer(this.active)
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
    this.startSource(this.active, 0)
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
    this.stopSource(this.standby)

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
    this.startSource(this.standby, 0)

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

    // 旧 active を止めて buffer を解放、役割を交換
    this.stopSource(this.active)
    this.releaseBuffer(this.active)
    this.swapActive()
    this.setCurrentTrack(track)
  }

  /**
   * 指定したデッキをフェードアウトして止める（停止は呼び出し側の責任）
   */
  private async fadeOut(deck: Deck, durationMs: number): Promise<void> {
    this.cancelFade(deck)
    if (!deck.isPlaying) return

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
   * active と standby のデッキを入れ替える。
   */
  private swapActive(): void {
    const tmp = this.active
    this.active = this.standby
    this.standby = tmp
  }

  /**
   * トラックのファイルを読み出して decodeAudioData() で AudioBuffer に展開し、
   * デッキにセットする。再生開始は呼び出し側で startSource() する。
   *
   * Tauri Android の Range request バグを避けるため WebView の HTTP 配信を
   * 一切経由せず、Rust 側で読んだ Vec<u8> を直接デコードする。
   */
  private async loadInto(deck: Deck, track: Track): Promise<void> {
    let playablePath: string
    try {
      playablePath = await invoke<string>('music_prepare_track', {
        trackId: track.id,
      })
    } catch (e) {
      throw new Error(`music_prepare_track failed: ${String(e)}`)
    }
    if (!playablePath) {
      throw new Error(`music_prepare_track returned empty path for track ${track.id}`)
    }

    let bytes: number[] | Uint8Array
    try {
      bytes = await invoke<number[] | Uint8Array>('music_read_file', {
        path: playablePath,
      })
    } catch (e) {
      throw new Error(`music_read_file failed: ${String(e)}`)
    }

    // decodeAudioData は渡された ArrayBuffer を detach するため、
    // Uint8Array が共有 buffer 上のビューだと元データも壊れる。
    // 安全のため必要範囲だけコピーした独立 ArrayBuffer を渡す。
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
    const arrayBuffer = u8.buffer.slice(
      u8.byteOffset,
      u8.byteOffset + u8.byteLength
    ) as ArrayBuffer

    let audioBuffer: AudioBuffer
    try {
      audioBuffer = await this.ctx.decodeAudioData(arrayBuffer)
    } catch (e) {
      throw new Error(`decodeAudioData failed: ${String(e)}`)
    }

    deck.buffer = audioBuffer
    deck.durationSec = audioBuffer.duration
    deck.pausedAtSec = 0
    deck.isPlaying = false
  }
}

/**
 * 1 曲分の再生経路をまとめた構造体。
 */
interface Deck {
  // BufferSource は使い捨て: 再生 / シーク / 再開のたびに作り直す
  source: AudioBufferSourceNode | null
  buffer: AudioBuffer | null
  normGain: GainNode
  fadeGain: GainNode

  // HTMLAudioElement の置き換えで自前管理が必要なもの
  startedAtCtxTime: number  // ctx.currentTime ベース。再生開始時刻 (offset 込み)
  pausedAtSec: number       // pause / 停止時の経過秒
  isPlaying: boolean
  durationSec: number       // buffer.duration を保持

  // 意図的停止と自然終端を区別するためのフラグ
  endedHandled: boolean
}

// アプリ全体で共有する singleton
export const musicPlayer = new MusicPlayer()
