// ts/lib/music.ts
//
//   desktop  : HTMLAudioElement + Web Audio (LUFS 補正は AudioNode 側)
//   Android  : ネイティブの MusicPlaybackService に再生・キュー・進行を委譲。
//              JS は queue / current track の表示用ミラーだけを保持する。

import { invoke, addPluginListener, type PluginListener } from '@tauri-apps/api/core'
import { platform } from '@tauri-apps/plugin-os'
import { type Track, startPlay, updateListenedMs } from './db'
import { usePlayerStore } from './playerStore'
import { useSettingsStore } from './settingsStore'
import { sendPlayHistory } from './historySender'

const TARGET_LUFS = -14.0
const NORM_TIME_CONSTANT_SEC = 0.05
const POSITION_POLL_MS = 200
const STOP_FADEOUT_MS = 500
// 累積リスニング時間 (listened_ms) を DB にフラッシュする間隔。
const LISTEN_FLUSH_MS = 5000

// ============================================================================
// 共通インターフェース
// ============================================================================

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

// ============================================================================
// 共通実装
// ============================================================================

// isTrailingSilence が ON のとき、末尾無音を除いた有効再生長 (ms) を返す。
// 無音を引いた結果が 0 以下になる場合は実尺をそのまま返す。
function trimTrailingSilence(fullMs: number, trim: boolean, track: Track | null): number {
  const silence = trim ? (track?.trailing_silence_ms ?? 0) : 0
  const eff = fullMs - silence
  return eff > 0 ? eff : fullMs
}

// listened_ms の DB 書き込みを担う。
// 現在再生中トラックの history 行 (rowid) の Promise を保持し、
// 曲頭で startPlay() を投げ、確定時 / フラッシュ時に await して updateListenedMs する。
// rowid そのものではなく Promise を持つことで、背景でイベントがまとめて replay
// されても「開始 INSERT がまだ解決していない曲」を取りこぼさない。
class ListenTracker {
  private current: Promise<number> | null = null
  private lastFlushMs = 0  // 最後に DB へ書いた累積 ms

  constructor(private logTag: string) {}

  // 新しい曲の history 行を作り始める。
  begin(trackId: number): void {
    const p = startPlay(trackId)
    p.catch(e => console.error(`[${this.logTag}] startPlay failed:`, e))
    this.current = p
    this.lastFlushMs = 0
  }

  // 再生中の定期フラッシュ (LISTEN_FLUSH_MS ぶん進むごとに 1 回)。
  flush(listenedMs: number): void {
    if (this.current && listenedMs - this.lastFlushMs >= LISTEN_FLUSH_MS) {
      this.lastFlushMs = listenedMs
      this.write(this.current, listenedMs)
    }
  }

  // いま終わる曲の確定 listened_ms を書き、セッションを閉じる。
  finalize(listenedMs: number): void {
    if (this.current) this.write(this.current, listenedMs)
    this.current = null
    this.lastFlushMs = 0
  }

  private write(p: Promise<number>, ms: number): void {
    void p.then(id => updateListenedMs(id, ms)).catch(e =>
      console.error(`[${this.logTag}] updateListenedMs failed:`, e))
  }
}

// queue / history / currentTrack のローカル状態と、キュー操作の共通部分。
// 境界チェック・重複ガード・store への同期はここで一元化し、
// ネイティブ実装は on* フックを上書きして同じ操作をネイティブ側へ転送する。
abstract class QueuedMusicPlayer implements MusicPlayer {
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

// ============================================================================
// Android ネイティブ実装
// ============================================================================

interface NativePlaybackEvent {
  type: 'trackChanged' | 'playingChanged' | 'positionChanged' | 'queueEnded' | 'error'
  index?: number
  item?: { trackId: number; title: string; artist: string } | null
  isPlaying?: boolean
  positionMs?: number
  durationMs?: number
  // playbackSeek 完了直後にネイティブが送る position イベントだけ true。
  // 通常の positionRunnable (250ms 周期) 由来の position と区別するためのフラグ。
  fromSeek?: boolean
  // positionChanged: 現在再生中トラックのネイティブ側累積リスニング時間 (ms)。
  listenedMs?: number
  // trackChanged / queueEnded: いま終わったトラックの確定リスニング時間 (ms)。
  // ネイティブ側で正確に計測されており、JS が背景でフリーズしていても取りこぼさない。
  prevListenedMs?: number
  message?: string
}

class NativeAndroidMusicPlayer extends QueuedMusicPlayer {
  // 表示用に Track 全体を覚えておく。ネイティブから来るイベントは trackId のみ。
  private trackById: Map<number, Track> = new Map()

  // 末尾無音カット用。ネイティブから来た現曲の実尺と設定フラグを保持する。
  private nativeDurationMs: number | null = null
  private isTrailingSilence: boolean
  // 無音到達で next() を呼んだ後、次曲の trackChanged が来るまで再発火を抑止する。
  private advancingSilence = false

  private pluginListener: Promise<PluginListener | null>
  private unsubscribeSettings: () => void

  // seek 抑制フラグ。
  // seek() を呼んでからネイティブが「seek を反映した」確定通知 (fromSeek=true の
  // positionChanged) を返すまでの間、通常の positionChanged を無視する。
  // これがないと seekTo 完了前に positionRunnable が古い位置を送り続け、
  // シークバーが「シーク前の位置に巻き戻ってから飛ぶ」バックジャンプを起こす。
  private awaitingSeekEcho = false

  // listened_ms 計測。累積はネイティブ (positionRunnable) が担い、
  // JS は受け取った値を DB に書くだけ。
  // これにより画面オフ等で webview がフリーズしても計測が止まらない。
  private listen = new ListenTracker('NativePlayer')
  // 直近 positionChanged で受け取ったネイティブ累積 ms (フォールバック用)。
  private lastListenedMs = 0

  constructor() {
    super()
    // 設定購読: 音量・正規化フラグの変化をネイティブに転送する。
    const s = useSettingsStore.getState()
    this.isTrailingSilence = s.isTrailingSilence
    this.pushVolume(s.masterVolume, s.isNormalizeVolume)
    this.unsubscribeSettings = useSettingsStore.subscribe((state, prev) => {
      const volChanged = state.masterVolume !== prev.masterVolume
      const normChanged = state.isNormalizeVolume !== prev.isNormalizeVolume
      if (volChanged || normChanged) {
        this.pushVolume(state.masterVolume, state.isNormalizeVolume)
      }
      if (state.isTrailingSilence !== prev.isTrailingSilence) {
        this.isTrailingSilence = state.isTrailingSilence
        // 設定変更を MiniPlayer の表示長へ即時反映する
        usePlayerStore.getState()._setDuration(this.effectiveDurationMs())
      }
    })

    // ネイティブからのイベント購読。
    // Plugin.trigger() (Kotlin) は Channel ベースで配信されるため、
    // listen() ではなく addPluginListener() で受ける必要がある。
    this.pluginListener = addPluginListener<NativePlaybackEvent>(
      'android-media',
      'playbackEvent',
      (payload) => { this.onNativeEvent(payload) },
    ).catch(err => {
      console.error('[NativePlayer] addPluginListener failed:', err)
      return null
    })
  }

  dispose(): void {
    this.unsubscribeSettings()
    void this.pluginListener.then(l => l?.unregister())
  }

  // ---- 内部: 状態更新 ----

  private rememberTrack(t: Track): void {
    this.trackById.set(t.id, t)
  }

  // ---- 内部: listened_ms 計測 ----

  private beginListen(trackId: number): void {
    this.listen.begin(trackId)
    this.lastListenedMs = 0
  }

  private finalizeListen(listenedMs: number | undefined): void {
    this.listen.finalize(listenedMs ?? this.lastListenedMs)
    this.lastListenedMs = 0
  }

  private flushListen(listenedMs: number): void {
    this.lastListenedMs = listenedMs
    this.listen.flush(listenedMs)
  }

  // isTrailingSilence が ON のとき、末尾無音を除いた有効再生長 (ms) を返す。
  // OFF または無音情報が無い場合は実尺をそのまま返す。
  private effectiveDurationMs(): number | null {
    if (this.nativeDurationMs == null || this.nativeDurationMs <= 0) return this.nativeDurationMs
    return trimTrailingSilence(this.nativeDurationMs, this.isTrailingSilence, this.currentTrack)
  }

  private pushVolume(masterVolume: number, isNormalize: boolean): void {
    // master volume と正規化 ON/OFF をネイティブへ。曲ごとの LUFS ゲインは
    // setQueue 時に extras で渡してあり、ネイティブ側が isNormalize=false のときは
    // 曲ゲインを無視するので、再生中でも即時に切り替わる。
    void invoke('music_native_set_volume', {
      volume: masterVolume,
      normalize: isNormalize,
    }).catch(err => {
      console.error('[NativePlayer] set_volume failed:', err)
    })
  }

  // Media3 の onMediaItemTransition から来た「今再生中の曲」(trackId) に合わせて、
  // JS 側の queue (= 「これから流れる曲」) / history を巻き取り、currentTrack を更新する。
  private reconcileTrackChange(newId: number): void {
    const idxInQueue = this.queue.findIndex(t => t.id === newId)
    const idxInHistory = this.history.findIndex(t => t.id === newId)

    if (idxInQueue >= 0) {
      // 前進: 飛ばされた曲を history に積み、新 current を queue から取り出す
      if (this.currentTrack) this.history.push(this.currentTrack)
      for (let i = 0; i < idxInQueue; i++) {
        const skipped = this.queue.shift()
        if (skipped) this.history.push(skipped)
      }
      this.currentTrack = this.queue.shift() ?? null
    } else if (idxInHistory >= 0) {
      // 後退: 現曲と history の途中までを queue 先頭に戻す
      if (this.currentTrack) this.queue.unshift(this.currentTrack)
      for (let i = this.history.length - 1; i > idxInHistory; i--) {
        const reverted = this.history.pop()
        if (reverted) this.queue.unshift(reverted)
      }
      this.currentTrack = this.history.pop() ?? null
    } else {
      // queue にも history にも無い (= play(track) の初回など)
      this.currentTrack = this.trackById.get(newId) ?? null
    }
  }

  private onNativeEvent(ev: NativePlaybackEvent): void {
    const store = usePlayerStore.getState()
    switch (ev.type) {
      case 'trackChanged': {
        // 曲が変われば seek 抑制は無効。新しい曲の position 0 は正しい値なので、
        // 抑制を残すと曲頭表示が古いシーク位置に固まってしまう。
        this.awaitingSeekEcho = false
        this.advancingSilence = false
        if (ev.item == null) {
          this.finalizeListen(ev.prevListenedMs)
          this.currentTrack = null
          this.nativeDurationMs = null
          store._setCurrentTrack(null)
          store._setIsPlaying(false)
          store._setPosition(0)
          store._setDuration(null)
        } else {
          const newId = ev.item.trackId
          if (this.currentTrack?.id === newId) {
            // 同じ曲のまま (例: seek後のイベント) — 何もしない
            break
          }
          this.reconcileTrackChange(newId)
          // いま終わった曲を確定してから、新しい曲のセッションを開始する。
          this.finalizeListen(ev.prevListenedMs)
          store._setCurrentTrack(this.currentTrack)
          store._setIsPlaying(true)
          store._setPosition(0)
          this.nativeDurationMs = ev.durationMs != null ? ev.durationMs : null
          store._setDuration(this.effectiveDurationMs())
          if (this.currentTrack) {
            this.beginListen(this.currentTrack.id)
            sendPlayHistory(this.currentTrack.title, this.currentTrack.artist ?? null)
          }
          this.syncQueue()
        }
        break
      }
      case 'playingChanged': {
        store._setIsPlaying(!!ev.isPlaying)
        break
      }
      case 'positionChanged': {
        if (ev.durationMs != null && ev.durationMs > 0) {
          this.nativeDurationMs = ev.durationMs
          store._setDuration(this.effectiveDurationMs())
        }
        if (ev.positionMs != null) {
          const effMs = this.effectiveDurationMs()
          // 末尾無音に到達したら次の曲へ。advancingSilence で再発火を抑止し、
          // 次曲の trackChanged で解除する。
          if (!this.advancingSilence && this.isTrailingSilence && effMs != null &&
              (this.currentTrack?.trailing_silence_ms ?? 0) > 0 && ev.positionMs >= effMs) {
            this.advancingSilence = true
            void this.next()
            break
          }
          if (ev.fromSeek) {
            // seek が反映された確定通知。抑制を解除し、以後は通常更新に戻す。
            this.awaitingSeekEcho = false
            store._setPosition(ev.positionMs)
          } else if (!this.awaitingSeekEcho) {
            // 通常の positionRunnable 由来。抑制中でなければ反映する。
            store._setPosition(ev.positionMs)
          }
          // awaitingSeekEcho 中の通常 position は無視 (巻き戻り防止)。
        }
        if (ev.listenedMs != null) this.flushListen(ev.listenedMs)
        break
      }
      case 'queueEnded': {
        this.finalizeListen(ev.prevListenedMs)
        this.currentTrack = null
        this.nativeDurationMs = null
        this.advancingSilence = false
        store._setCurrentTrack(null)
        store._setIsPlaying(false)
        store._setPosition(0)
        break
      }
      case 'error': {
        console.error('[NativePlayer] native error:', ev.message)
        break
      }
    }
  }

  // ---- 公開 API ----

  async play(track: Track): Promise<void> {
    // 2 段送信 (B1):
    //   Phase 1: track 1 曲だけネイティブに渡して即座に再生開始する。
    //            ここで音が鳴り始めるので体感レイテンシは Phase 1 だけで決まる。
    //   Phase 2: this.queue (これから流れる曲) を末尾に append する。
    //            Media3 の addMediaItems は再生中アイテムに影響しない。
    // 大きなキュー (1000 曲超) でも Phase 1 が軽いので最初の 1 曲は素早く鳴る。
    this.rememberTrack(track)
    await invoke('music_native_set_queue', {
      trackIds: [track.id],
      startIndex: 0,
    })
    if (this.queue.length > 0) {
      const restIds = this.queue.map(t => t.id)
      try {
        await invoke('music_native_append_queue', { trackIds: restIds })
      } catch (err) {
        console.error('[NativePlayer] append_queue failed:', err)
      }
    }
  }

  async stop(): Promise<void> {
    await invoke('music_native_clear')
  }

  async togglePause(): Promise<void> {
    await invoke('music_native_toggle_pause')
  }

  seek(ms: number): void {
    const target = Math.max(0, Math.floor(ms))
    // 楽観的更新: ネイティブの結果を待たずに UI を即座に seek 先へ動かす。
    // 同時に抑制フラグを立て、ネイティブの fromSeek 確定通知が来るまで
    // positionRunnable 由来の古い position で巻き戻らないようにする。
    this.awaitingSeekEcho = true
    usePlayerStore.getState()._setPosition(target)
    void invoke('music_native_seek', { positionMs: target })
  }

  async prev(): Promise<void> {
    await invoke('music_native_prev')
  }

  async next(): Promise<void> {
    await invoke('music_native_next')
  }

  // ---- キュー操作のネイティブ転送 (ローカル状態の更新は基底クラス) ----

  protected onQueueSet(tracks: Track[]): void {
    for (const t of tracks) this.rememberTrack(t)
    // 単に積むだけ (再生は始めない) のセマンティクスにする。
    // 直後に play(track) を呼ぶ呼び出し元が多いはず。
    // ただしネイティブには queue を渡しておいたほうが「次へ」が動くので、
    // startIndex=-1 で「再生はしない」を意味させる。
    void invoke('music_native_set_queue', {
      trackIds: tracks.map(t => t.id),
      startIndex: -1,
    })
  }

  protected onEnqueued(track: Track): void {
    this.rememberTrack(track)
    void invoke('music_native_enqueue', { trackId: track.id })
  }

  protected onRemoved(index: number): void {
    // index は「upcoming 中の index」をそのまま渡す。
    // native の絶対 index への変換は Kotlin 側で行う。
    void invoke('music_native_remove_at', { index })
  }

  protected onMoved(from: number, to: number): void {
    void invoke('music_native_move', { from, to })
  }

  protected onCleared(): void {
    if (this.currentTrack) {
      // 現曲は残して、ネイティブのキューの「現曲より後ろ」だけを空にする。
      // music_native_set_queue は startIndex=-1 のとき「現曲を維持して以降を置換」。
      void invoke('music_native_set_queue', {
        trackIds: [],
        startIndex: -1,
      })
    } else {
      void invoke('music_native_clear')
    }
  }
}

// ============================================================================
// Desktop 実装
// ============================================================================

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

interface Deck {
  audio: HTMLAudioElement
  source: MediaElementAudioSourceNode
  normGain: GainNode
  fadeGain: GainNode
  durationSec: number
}

class DesktopMusicPlayer extends QueuedMusicPlayer {
  private ctx: AudioContext
  private masterGain: GainNode
  private active: Deck

  private currentBlobUrl: string | null = null

  private masterVolume: number
  private isNormalizeVolume: boolean
  private isTrailingSilence: boolean
  private unsubscribeSettings: () => void

  private positionPollId: ReturnType<typeof setInterval> | null = null

  // listened_ms 計測。desktop は webview が常に生きているので JS 側で累積する。
  private listen = new ListenTracker('MusicPlayer')
  private sessionListenedMs = 0   // 現セッションの累積リスニング時間 (ms)
  private lastPosMs = 0           // 前回ポーリング時の position (デルタ計算用)

  constructor() {
    super()
    this.ctx = new AudioContext()
    this.masterGain = this.ctx.createGain()
    const s = useSettingsStore.getState()
    this.masterVolume = s.masterVolume
    this.isNormalizeVolume = s.isNormalizeVolume
    this.isTrailingSilence = s.isTrailingSilence
    this.masterGain.gain.value = this.masterVolume
    this.masterGain.connect(this.ctx.destination)

    this.active = this.createDeck()
    this.startPositionPoll()

    this.unsubscribeSettings = useSettingsStore.subscribe((state, prev) => {
      if (state.masterVolume !== prev.masterVolume) {
        this.masterVolume = state.masterVolume
        this.masterGain.gain.setTargetAtTime(
          this.masterVolume, this.ctx.currentTime, NORM_TIME_CONSTANT_SEC
        )
      }
      if (state.isNormalizeVolume !== prev.isNormalizeVolume) {
        this.isNormalizeVolume = state.isNormalizeVolume
        this.applyLufsGain(this.active, this.currentTrack?.lufs ?? null)
      }
      if (state.isTrailingSilence !== prev.isTrailingSilence) {
        this.isTrailingSilence = state.isTrailingSilence
        // 設定変更を MiniPlayer の表示長へ即時反映する
        usePlayerStore.getState()._setDuration(this.effectiveDurationMs())
      }
    })
  }

  dispose(): void {
    this.unsubscribeSettings()
    this.stopPositionPoll()
    this.finalizeListen()
    try { this.active.audio.pause() } catch { /* ignore */ }
    this.active.audio.removeAttribute('src')
    this.active.audio.load()
    if (this.currentBlobUrl) {
      URL.revokeObjectURL(this.currentBlobUrl)
      this.currentBlobUrl = null
    }
  }

  async play(track: Track): Promise<void> {
    if (this.currentTrack?.id === track.id && !this.active.audio.paused) return
    if (this.ctx.state !== 'running') await this.ctx.resume()
    if (await this.startPlayback(track)) this.setCurrentTrack(track)
  }

  async stop(): Promise<void> {
    await this.fadeOut(this.active, STOP_FADEOUT_MS)
    this.active.audio.pause()
    this.setCurrentTrack(null)
  }

  async togglePause(): Promise<void> {
    if (!this.currentTrack) return
    if (this.active.audio.paused) {
      if (this.ctx.state !== 'running') await this.ctx.resume()
      try { await this.active.audio.play() }
      catch (e) { console.error('[MusicPlayer] audio.play failed:', e); return }
      usePlayerStore.getState()._setIsPlaying(true)
      if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing'
    } else {
      this.active.audio.pause()
      usePlayerStore.getState()._setIsPlaying(false)
      if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused'
    }
  }

  seek(ms: number): void {
    if (!this.active.durationSec) return
    const sec = Math.max(0, Math.min(this.active.durationSec, ms / 1000))
    this.active.audio.currentTime = sec
    usePlayerStore.getState()._setPosition(sec * 1000)
  }

  async prev(): Promise<void> {
    if (this.getActivePositionSec() > 3) { this.seek(0); return }
    const prevTrack = this.history.pop()
    if (!prevTrack) { this.seek(0); return }
    if (this.currentTrack) {
      this.queue.unshift(this.currentTrack); this.syncQueue()
    }
    await this.play(prevTrack)
  }

  async next(): Promise<void> {
    const nextTrack = this.queue.shift()
    this.syncQueue()
    if (!nextTrack) { await this.stop(); return }
    if (this.currentTrack) this.history.push(this.currentTrack)
    await this.play(nextTrack)
  }

  // ---- 内部 ----
  private createDeck(): Deck {
    const audio = new Audio()
    audio.preload = 'auto'
    const source = this.ctx.createMediaElementSource(audio)
    const normGain = this.ctx.createGain()
    const fadeGain = this.ctx.createGain()
    normGain.gain.value = 1.0; fadeGain.gain.value = 1.0
    source.connect(normGain); normGain.connect(fadeGain); fadeGain.connect(this.masterGain)
    const deck: Deck = { audio, source, normGain, fadeGain, durationSec: 0 }
    audio.addEventListener('ended', () => {
      this.onActiveEnded().catch(e => console.error('[MusicPlayer] onActiveEnded failed:', e))
    })
    return deck
  }
  private setCurrentTrack(track: Track | null): void {
    // 全てのトラック遷移 (play / next / onActiveEnded / stop) がここを通るので、
    // ここを唯一のチョークポイントにして「前の曲を確定 → 新しい曲を開始」する。
    this.finalizeListen()
    this.currentTrack = track
    const store = usePlayerStore.getState()
    store._setCurrentTrack(track)
    if (track === null) {
      store._setIsPlaying(false); store._setPosition(0); store._setDuration(null)
    } else {
      store._setIsPlaying(true); store._setDuration(this.effectiveDurationMs()); store._setPosition(0)
      this.beginListen(track)
      sendPlayHistory(track.title, track.artist ?? null)
    }
    this.updateMediaSession(track)
  }

  // active deck へロードして再生開始する。play() と onActiveEnded() で共有。
  // 失敗時はログを出して false を返す。
  private async startPlayback(track: Track): Promise<boolean> {
    this.cancelFade(this.active)
    try { await this.loadInto(this.active, track) }
    catch (e) { console.error('[MusicPlayer] loadInto failed:', e); return false }
    this.applyLufsGain(this.active, track.lufs ?? null)
    this.active.fadeGain.gain.cancelScheduledValues(this.ctx.currentTime)
    this.active.fadeGain.gain.setValueAtTime(1, this.ctx.currentTime)
    try { await this.active.audio.play() }
    catch (e) { console.error('[MusicPlayer] audio.play failed:', e); return false }
    return true
  }

  // ---- listened_ms 計測 ----
  private beginListen(track: Track): void {
    this.listen.begin(track.id)
    this.sessionListenedMs = 0
    this.lastPosMs = 0
  }
  private finalizeListen(): void {
    this.listen.finalize(this.sessionListenedMs)
    this.sessionListenedMs = 0
    this.lastPosMs = 0
  }
  private getActivePositionSec(): number { return this.active.audio.currentTime }
  private updateMediaSession(track: Track | null): void {
    if (!('mediaSession' in navigator)) return
    if (track === null) { navigator.mediaSession.playbackState = 'none'; return }
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title, artist: track.artist ?? '', album: track.album ?? '',
    })
    navigator.mediaSession.setActionHandler('play', () => { void this.togglePause() })
    navigator.mediaSession.setActionHandler('pause', () => { void this.togglePause() })
    navigator.mediaSession.setActionHandler('nexttrack', () => { void this.next() })
    navigator.mediaSession.setActionHandler('previoustrack', () => { void this.prev() })
    navigator.mediaSession.setActionHandler('seekto', (details) => {
      if (details.seekTime != null) this.seek(details.seekTime * 1000)
    })
    navigator.mediaSession.playbackState = 'playing'
  }
  private updatePositionState(): void {
    if (!('mediaSession' in navigator)) return
    const audio = this.active.audio
    if (!audio.duration || isNaN(audio.duration)) return
    navigator.mediaSession.setPositionState({
      duration: audio.duration, playbackRate: audio.playbackRate, position: audio.currentTime,
    })
  }
  // isTrailingSilence が ON のとき、末尾無音を除いた有効再生長 (ms) を返す。
  // OFF または無音情報が無い場合は実尺をそのまま返す。
  private effectiveDurationMs(): number | null {
    if (!this.currentTrack) return null
    const fullMs = this.active.durationSec * 1000
    if (fullMs <= 0) return null
    return trimTrailingSilence(fullMs, this.isTrailingSilence, this.currentTrack)
  }
  private startPositionPoll(): void {
    if (this.positionPollId !== null) return
    this.positionPollId = setInterval(() => {
      if (this.active.audio.paused) return
      const sec = this.active.audio.currentTime
      const effMs = this.effectiveDurationMs()
      // listened_ms 累積 (デルタ法): 通常再生の前進ぶんだけ足す。
      // 前方シーク (delta 大) / 後方シーク (delta 負) / 一時停止 (delta≈0) は加算されない。
      const posMs = sec * 1000
      const delta = posMs - this.lastPosMs
      if (delta > 0 && delta < POSITION_POLL_MS * 3) this.sessionListenedMs += delta
      this.lastPosMs = posMs
      this.listen.flush(this.sessionListenedMs)
      // 末尾無音に到達したら ended を待たずに次の曲へ
      if (effMs != null && this.isTrailingSilence &&
          (this.currentTrack?.trailing_silence_ms ?? 0) > 0 && sec * 1000 >= effMs) {
        this.active.audio.pause()
        void this.next().catch(e => console.error('[MusicPlayer] next failed:', e))
        return
      }
      const effSec = effMs != null ? effMs / 1000 : this.active.durationSec
      const clamped = Math.max(0, Math.min(effSec, sec))
      usePlayerStore.getState()._setPosition(clamped * 1000)
      this.updatePositionState()
    }, POSITION_POLL_MS)
  }
  private stopPositionPoll(): void {
    if (this.positionPollId !== null) { clearInterval(this.positionPollId); this.positionPollId = null }
  }
  private async onActiveEnded(): Promise<void> {
    usePlayerStore.getState()._setIsPlaying(false)
    if (this.currentTrack) this.history.push(this.currentTrack)
    const nextTrack = this.queue.shift(); this.syncQueue()
    if (!nextTrack) { this.setCurrentTrack(null); return }
    if (await this.startPlayback(nextTrack)) this.setCurrentTrack(nextTrack)
  }
  private async fadeOut(deck: Deck, durationMs: number): Promise<void> {
    this.cancelFade(deck)
    if (deck.audio.paused) return
    const now = this.ctx.currentTime; const dur = durationMs / 1000
    const g = deck.fadeGain.gain
    g.cancelScheduledValues(now); g.setValueAtTime(g.value, now)
    g.linearRampToValueAtTime(0, now + dur)
    await new Promise<void>(resolve => setTimeout(resolve, durationMs))
  }
  private cancelFade(deck: Deck): void {
    const now = this.ctx.currentTime; const g = deck.fadeGain.gain
    const current = g.value; g.cancelScheduledValues(now); g.setValueAtTime(current, now)
  }
  private applyLufsGain(deck: Deck, trackLufs: number | null): void {
    const gain = !this.isNormalizeVolume ? 1.0
      : trackLufs != null && isFinite(trackLufs)
        ? Math.pow(10, (TARGET_LUFS - trackLufs) / 20) : 1.0
    deck.normGain.gain.setTargetAtTime(gain, this.ctx.currentTime, NORM_TIME_CONSTANT_SEC)
  }
  private async loadInto(deck: Deck, track: Track): Promise<void> {
    if (this.currentBlobUrl) { URL.revokeObjectURL(this.currentBlobUrl); this.currentBlobUrl = null }
    let buf: ArrayBuffer
    try {
      const result = await invoke<ArrayBuffer | Uint8Array | number[]>(
        'music_read_file', { trackId: track.id }
      )
      if (result instanceof ArrayBuffer) buf = result
      else if (ArrayBuffer.isView(result)) {
        const v = result as Uint8Array
        buf = v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength) as ArrayBuffer
      } else if (Array.isArray(result)) {
        buf = new Uint8Array(result).buffer as ArrayBuffer
      } else throw new Error('unexpected music_read_file response type')
    } catch (e) { throw new Error(`music_read_file failed: ${String(e)}`) }
    const mime = mimeForPath(track.path)
    const blob = new Blob([buf], { type: mime })
    const url = URL.createObjectURL(blob)
    this.currentBlobUrl = url
    await new Promise<void>((resolve, reject) => {
      const onCanPlay = () => { deck.audio.removeEventListener('error', onError); resolve() }
      const onError = () => {
        deck.audio.removeEventListener('canplay', onCanPlay)
        const err = deck.audio.error
        reject(new Error(`audio error: code=${err?.code ?? 'unknown'} ${err?.message ?? ''}`))
      }
      deck.audio.addEventListener('canplay', onCanPlay, { once: true })
      deck.audio.addEventListener('error', onError, { once: true })
      deck.audio.src = url; deck.audio.load()
    })
    deck.durationSec = isFinite(deck.audio.duration) ? deck.audio.duration : 0
  }
}

// ============================================================================
// プラットフォーム判定 + singleton
// ============================================================================

function isAndroid(): boolean {
  try { return platform() === 'android' } catch { return false }
}

export const musicPlayer: MusicPlayer = isAndroid()
  ? new NativeAndroidMusicPlayer()
  : new DesktopMusicPlayer()
