// desktop: HTMLAudioElement + Web Audio で再生する。LUFS 補正は GainNode 側。

import { invoke } from '@tauri-apps/api/core'
import type { Track } from '../db'
import { usePlayerStore } from '../playerStore'
import { useSettingsStore } from '../settingsStore'
import { sendPlayHistory } from '../historySender'
import { ListenTracker } from './listenTracker'
import { QueuedMusicPlayer, trimTrailingSilence } from './queuedPlayer'

const TARGET_LUFS = -14.0
const NORM_TIME_CONSTANT_SEC = 0.05
const POSITION_POLL_MS = 200
const STOP_FADEOUT_MS = 500

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

export class DesktopMusicPlayer extends QueuedMusicPlayer {
  private ctx: AudioContext
  private masterGain: GainNode
  // audio → normGain (LUFS 補正) → fadeGain (停止時のフェード) → masterGain
  private audio: HTMLAudioElement
  private normGain: GainNode
  private fadeGain: GainNode
  private durationSec = 0

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

    this.audio = new Audio()
    this.audio.preload = 'auto'
    const source = this.ctx.createMediaElementSource(this.audio)
    this.normGain = this.ctx.createGain()
    this.fadeGain = this.ctx.createGain()
    source.connect(this.normGain); this.normGain.connect(this.fadeGain); this.fadeGain.connect(this.masterGain)
    this.audio.addEventListener('ended', () => {
      this.onEnded().catch(e => console.error('[MusicPlayer] onEnded failed:', e))
    })

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
        this.applyLufsGain(this.currentTrack?.lufs ?? null)
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
    try { this.audio.pause() } catch { /* ignore */ }
    this.audio.removeAttribute('src')
    this.audio.load()
    if (this.currentBlobUrl) {
      URL.revokeObjectURL(this.currentBlobUrl)
      this.currentBlobUrl = null
    }
  }

  async play(track: Track): Promise<void> {
    if (this.currentTrack?.id === track.id && !this.audio.paused) return
    if (this.ctx.state !== 'running') await this.ctx.resume()
    if (await this.startPlayback(track)) this.setCurrentTrack(track)
  }

  async stop(): Promise<void> {
    await this.fadeOut(STOP_FADEOUT_MS)
    this.audio.pause()
    this.setCurrentTrack(null)
  }

  async togglePause(): Promise<void> {
    if (!this.currentTrack) return
    if (this.audio.paused) {
      if (this.ctx.state !== 'running') await this.ctx.resume()
      try { await this.audio.play() }
      catch (e) { console.error('[MusicPlayer] audio.play failed:', e); return }
      usePlayerStore.getState()._setIsPlaying(true)
      if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing'
    } else {
      this.audio.pause()
      usePlayerStore.getState()._setIsPlaying(false)
      if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused'
    }
  }

  seek(ms: number): void {
    if (!this.durationSec) return
    const sec = Math.max(0, Math.min(this.durationSec, ms / 1000))
    this.audio.currentTime = sec
    usePlayerStore.getState()._setPosition(sec * 1000)
  }

  async prev(): Promise<void> {
    if (this.audio.currentTime > 3) { this.seek(0); return }
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
  private setCurrentTrack(track: Track | null): void {
    // 全てのトラック遷移 (play / next / onEnded / stop) がここを通るので、
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

  // ロードして再生開始する。play() と onEnded() で共有。
  // 失敗時はログを出して false を返す。
  private async startPlayback(track: Track): Promise<boolean> {
    this.cancelFade()
    try { await this.load(track) }
    catch (e) { console.error('[MusicPlayer] load failed:', e); return false }
    this.applyLufsGain(track.lufs ?? null)
    this.fadeGain.gain.cancelScheduledValues(this.ctx.currentTime)
    this.fadeGain.gain.setValueAtTime(1, this.ctx.currentTime)
    try { await this.audio.play() }
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
    const audio = this.audio
    if (!audio.duration || isNaN(audio.duration)) return
    navigator.mediaSession.setPositionState({
      duration: audio.duration, playbackRate: audio.playbackRate, position: audio.currentTime,
    })
  }
  // isTrailingSilence が ON のとき、末尾無音を除いた有効再生長 (ms) を返す。
  // OFF または無音情報が無い場合は実尺をそのまま返す。
  private effectiveDurationMs(): number | null {
    if (!this.currentTrack) return null
    const fullMs = this.durationSec * 1000
    if (fullMs <= 0) return null
    return trimTrailingSilence(fullMs, this.isTrailingSilence, this.currentTrack)
  }
  private startPositionPoll(): void {
    if (this.positionPollId !== null) return
    this.positionPollId = setInterval(() => {
      if (this.audio.paused) return
      const sec = this.audio.currentTime
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
        this.audio.pause()
        void this.next().catch(e => console.error('[MusicPlayer] next failed:', e))
        return
      }
      const effSec = effMs != null ? effMs / 1000 : this.durationSec
      const clamped = Math.max(0, Math.min(effSec, sec))
      usePlayerStore.getState()._setPosition(clamped * 1000)
      this.updatePositionState()
    }, POSITION_POLL_MS)
  }
  private stopPositionPoll(): void {
    if (this.positionPollId !== null) { clearInterval(this.positionPollId); this.positionPollId = null }
  }
  private async onEnded(): Promise<void> {
    usePlayerStore.getState()._setIsPlaying(false)
    if (this.currentTrack) this.history.push(this.currentTrack)
    const nextTrack = this.queue.shift(); this.syncQueue()
    if (!nextTrack) { this.setCurrentTrack(null); return }
    if (await this.startPlayback(nextTrack)) this.setCurrentTrack(nextTrack)
  }
  private async fadeOut(durationMs: number): Promise<void> {
    this.cancelFade()
    if (this.audio.paused) return
    const now = this.ctx.currentTime; const dur = durationMs / 1000
    const g = this.fadeGain.gain
    g.cancelScheduledValues(now); g.setValueAtTime(g.value, now)
    g.linearRampToValueAtTime(0, now + dur)
    await new Promise<void>(resolve => setTimeout(resolve, durationMs))
  }
  private cancelFade(): void {
    const now = this.ctx.currentTime; const g = this.fadeGain.gain
    const current = g.value; g.cancelScheduledValues(now); g.setValueAtTime(current, now)
  }
  private applyLufsGain(trackLufs: number | null): void {
    const gain = !this.isNormalizeVolume ? 1.0
      : trackLufs != null && isFinite(trackLufs)
        ? Math.pow(10, (TARGET_LUFS - trackLufs) / 20) : 1.0
    this.normGain.gain.setTargetAtTime(gain, this.ctx.currentTime, NORM_TIME_CONSTANT_SEC)
  }
  private async load(track: Track): Promise<void> {
    if (this.currentBlobUrl) { URL.revokeObjectURL(this.currentBlobUrl); this.currentBlobUrl = null }
    // Rust 側は ipc::Response でファイルの中身をそのまま返すので ArrayBuffer で届く
    let buf: ArrayBuffer
    try { buf = await invoke<ArrayBuffer>('music_read_file', { trackId: track.id }) }
    catch (e) { throw new Error(`music_read_file failed: ${String(e)}`) }
    const blob = new Blob([buf], { type: mimeForPath(track.path) })
    const url = URL.createObjectURL(blob)
    this.currentBlobUrl = url
    const audio = this.audio
    await new Promise<void>((resolve, reject) => {
      const onCanPlay = () => { audio.removeEventListener('error', onError); resolve() }
      const onError = () => {
        audio.removeEventListener('canplay', onCanPlay)
        const err = audio.error
        reject(new Error(`audio error: code=${err?.code ?? 'unknown'} ${err?.message ?? ''}`))
      }
      audio.addEventListener('canplay', onCanPlay, { once: true })
      audio.addEventListener('error', onError, { once: true })
      audio.src = url; audio.load()
    })
    this.durationSec = isFinite(audio.duration) ? audio.duration : 0
  }
}
