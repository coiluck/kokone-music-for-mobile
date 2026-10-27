// Android: ネイティブの MusicPlaybackService (Media3) に再生・キュー・進行を委譲する。
// JS は queue / current track の表示用ミラーだけを保持する。

import { invoke, addPluginListener, type PluginListener } from '@tauri-apps/api/core'
import type { Track } from '../db'
import { usePlayerStore } from '../playerStore'
import { useSettingsStore } from '../settingsStore'
import { sendPlayHistory } from '../historySender'
import { ListenTracker } from './listenTracker'
import { QueuedMusicPlayer, trimTrailingSilence } from './queuedPlayer'

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

export class NativeAndroidMusicPlayer extends QueuedMusicPlayer {
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
