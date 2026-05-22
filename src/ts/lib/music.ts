// ts/lib/music.ts の置き換え
//
// 設計: プラットフォームで再生エンジンを切り替える。
//
//   desktop  : 従来どおり HTMLAudioElement + Web Audio (LUFS 補正は AudioNode 側)
//   Android  : ネイティブの MusicPlaybackService に再生・キュー・進行を委譲。
//              JS は queue / current track の表示用ミラーだけを保持する。

import { invoke, addPluginListener, type PluginListener } from '@tauri-apps/api/core'
import { platform } from '@tauri-apps/plugin-os'
import { type Track, musicPlay } from './db'
import { usePlayerStore } from './playerStore'
import { useSettingsStore } from './settingsStore'
import { sendPlayHistory } from './historySender'

const TARGET_LUFS = -14.0
const NORM_TIME_CONSTANT_SEC = 0.05
const POSITION_POLL_MS = 200
const STOP_FADEOUT_MS = 500

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
  message?: string
}

class NativeAndroidMusicPlayer implements MusicPlayer {
  // 表示用に Track 全体を覚えておく。ネイティブから来るイベントは trackId のみ。
  private queue: Track[] = []
  private history: Track[] = []
  private currentTrack: Track | null = null
  private trackById: Map<number, Track> = new Map()

  private pluginListener: Promise<PluginListener | null>
  private unsubscribeSettings: () => void

  // seek 抑制フラグ。
  // seek() を呼んでからネイティブが「seek を反映した」確定通知 (fromSeek=true の
  // positionChanged) を返すまでの間、通常の positionChanged を無視する。
  // これがないと seekTo 完了前に positionRunnable が古い位置を送り続け、
  // シークバーが「シーク前の位置に巻き戻ってから飛ぶ」バックジャンプを起こす。
  private awaitingSeekEcho = false

  constructor() {
    // 設定購読: 音量・正規化フラグの変化をネイティブに転送する。
    const s = useSettingsStore.getState()
    this.pushVolume(s.masterVolume, s.isNormalizeVolume)
    this.unsubscribeSettings = useSettingsStore.subscribe((state, prev) => {
      const volChanged = state.masterVolume !== prev.masterVolume
      const normChanged = state.isNormalizeVolume !== prev.isNormalizeVolume
      if (volChanged || normChanged) {
        this.pushVolume(state.masterVolume, state.isNormalizeVolume)
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

  private syncQueue(): void {
    usePlayerStore.getState()._setQueue([...this.queue])
  }

  private pushVolume(masterVolume: number, isNormalize: boolean): void {
    // LUFS 補正は曲ごとに setQueue で渡しているので、ネイティブの master だけ更新。
    // 正規化 OFF にしたい場合は、setQueue 時に gain=1.0 で入れ直す形にしたいが、
    // 簡略化のため master のみ送る。ON/OFF 切替は次の setQueue から効く。
    void invoke('music_native_set_volume', { volume: masterVolume }).catch(err => {
      console.error('[NativePlayer] set_volume failed:', err)
    })
    if (!isNormalize) {
      // 正規化 OFF を即時反映したい場合はここで現キューを gain=1 で再構築するなど。
      // 今は次の setQueue まで待つ仕様。
    }
  }

  private onNativeEvent(ev: NativePlaybackEvent): void {
    const store = usePlayerStore.getState()
    switch (ev.type) {
      case 'trackChanged': {
        // 曲が変われば seek 抑制は無効。新しい曲の position 0 は正しい値なので、
        // 抑制を残すと曲頭表示が古いシーク位置に固まってしまう。
        this.awaitingSeekEcho = false
        if (ev.item == null) {
          this.currentTrack = null
          store._setCurrentTrack(null)
          store._setIsPlaying(false)
          store._setPosition(0)
          store._setDuration(null)
        } else {
          // Media3 の onMediaItemTransition から来た「今再生中の曲」。
          // JS 側の queue (= 「これから流れる曲」) との整合を trackId で取る。
          const newId = ev.item.trackId
          if (this.currentTrack?.id === newId) {
            // 同じ曲のまま (例: seek後のイベント) — 何もしない
            break
          }
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
          store._setCurrentTrack(this.currentTrack)
          store._setIsPlaying(true)
          store._setPosition(0)
          store._setDuration(ev.durationMs != null ? ev.durationMs : null)
          if (this.currentTrack) {
            musicPlay(this.currentTrack.id).catch(e =>
              console.error('[NativePlayer] musicPlay failed:', e)
            )
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
        if (ev.positionMs != null) {
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
        if (ev.durationMs != null && ev.durationMs > 0) store._setDuration(ev.durationMs)
        break
      }
      case 'queueEnded': {
        this.currentTrack = null
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

  setQueue(tracks: Track[]): void {
    for (const t of tracks) this.rememberTrack(t)
    this.queue = [...tracks]
    this.syncQueue()
    // 単に積むだけ (再生は始めない) のセマンティクスにする。
    // 直後に play(track) を呼ぶ呼び出し元が多いはず。
    // ただしネイティブには queue を渡しておいたほうが「次へ」が動くので、
    // startIndex=-1 で「再生はしない」を意味させる。
    void invoke('music_native_set_queue', {
      trackIds: tracks.map(t => t.id),
      startIndex: -1,
    })
  }

  enqueue(track: Track): void {
    // すでにある曲を enqueue しない
    if (this.currentTrack?.id === track.id) return
    if (this.queue.some(t => t.id === track.id)) return

    this.rememberTrack(track)
    this.queue.push(track)
    this.syncQueue()
    void invoke('music_native_enqueue', { trackId: track.id })
  }

  removeFromQueue(index: number): void {
    if (index < 0 || index >= this.queue.length) return
    this.queue.splice(index, 1)
    this.syncQueue()
    // index は「upcoming 中の index」をそのまま渡す。
    // native の絶対 index への変換は Kotlin 側で行う。
    void invoke('music_native_remove_at', { index })
  }

  moveInQueue(from: number, to: number): void {
    if (from < 0 || from >= this.queue.length) return
    if (to < 0 || to >= this.queue.length) return
    if (from === to) return
    const [moved] = this.queue.splice(from, 1)
    this.queue.splice(to, 0, moved)
    this.syncQueue()
    void invoke('music_native_move', { from, to })
  }

  clearQueue(): void {
    this.queue = []
    this.syncQueue()
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

  getQueue(): readonly Track[] {
    return this.queue
  }

  getCurrentTrack(): Track | null {
    return this.currentTrack
  }

  pushHistory(track: Track): void {
    this.history.push(track)
  }
}

// ============================================================================
// Desktop 実装 (従来コードをそのまま class 化)
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

class DesktopMusicPlayer implements MusicPlayer {
  private ctx: AudioContext
  private masterGain: GainNode
  private active: Deck

  private currentTrack: Track | null = null
  private queue: Track[] = []
  private history: Track[] = []
  private currentBlobUrl: string | null = null

  private masterVolume: number
  private isNormalizeVolume: boolean
  private isTrailingSilence: boolean
  private unsubscribeSettings: () => void

  private positionPollId: ReturnType<typeof setInterval> | null = null

  constructor() {
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
      }
    })
  }

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

  async play(track: Track): Promise<void> {
    if (this.currentTrack?.id === track.id && !this.active.audio.paused) return
    if (this.ctx.state !== 'running') await this.ctx.resume()
    this.cancelFade(this.active)
    try { await this.loadInto(this.active, track) }
    catch (e) { console.error('[MusicPlayer] loadInto failed:', e); return }
    this.applyLufsGain(this.active, track.lufs ?? null)
    this.active.fadeGain.gain.cancelScheduledValues(this.ctx.currentTime)
    this.active.fadeGain.gain.setValueAtTime(1, this.ctx.currentTime)
    try { await this.active.audio.play() }
    catch (e) { console.error('[MusicPlayer] audio.play failed:', e); return }
    this.setCurrentTrack(track)
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

  setQueue(tracks: Track[]): void { this.queue = [...tracks]; this.syncQueue() }
  enqueue(track: Track): void {
    // すでにある曲を enqueue しない
    if (this.currentTrack?.id === track.id) return
    if (this.queue.some(t => t.id === track.id)) return

    this.queue.push(track);
    this.syncQueue()
  }
  removeFromQueue(index: number): void {
    if (index < 0 || index >= this.queue.length) return
    this.queue.splice(index, 1); this.syncQueue()
  }
  moveInQueue(from: number, to: number): void {
    if (from < 0 || from >= this.queue.length) return
    if (to < 0 || to >= this.queue.length) return
    if (from === to) return
    const [moved] = this.queue.splice(from, 1)
    this.queue.splice(to, 0, moved); this.syncQueue()
  }
  clearQueue(): void { this.queue = []; this.syncQueue() }
  getQueue(): readonly Track[] { return this.queue }
  getCurrentTrack(): Track | null { return this.currentTrack }
  pushHistory(track: Track): void { this.history.push(track) }

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
  private syncQueue(): void { usePlayerStore.getState()._setQueue([...this.queue]) }
  private setCurrentTrack(track: Track | null): void {
    this.currentTrack = track
    const store = usePlayerStore.getState()
    store._setCurrentTrack(track)
    if (track === null) {
      store._setIsPlaying(false); store._setPosition(0); store._setDuration(null)
    } else {
      store._setIsPlaying(true); store._setDuration(this.active.durationSec * 1000); store._setPosition(0)
      musicPlay(track.id).catch(e => console.error('[MusicPlayer] musicPlay failed:', e))
      sendPlayHistory(track.title, track.artist ?? null)
    }
    this.updateMediaSession(track)
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
  private startPositionPoll(): void {
    if (this.positionPollId !== null) return
    this.positionPollId = setInterval(() => {
      if (this.active.audio.paused) return
      const sec = this.active.audio.currentTime
      const clamped = Math.max(0, Math.min(this.active.durationSec, sec))
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
    this.cancelFade(this.active)
    try { await this.loadInto(this.active, nextTrack) }
    catch (e) { console.error('[MusicPlayer] loadInto failed:', e); return }
    this.applyLufsGain(this.active, nextTrack.lufs ?? null)
    this.active.fadeGain.gain.cancelScheduledValues(this.ctx.currentTime)
    this.active.fadeGain.gain.setValueAtTime(1, this.ctx.currentTime)
    try { await this.active.audio.play() }
    catch (e) { console.error('[MusicPlayer] audio.play failed:', e); return }
    this.setCurrentTrack(nextTrack)
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