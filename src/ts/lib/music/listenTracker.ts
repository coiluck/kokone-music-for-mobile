import { startPlay, updateListenedMs } from '../db'

// 累積リスニング時間 (listened_ms) を DB にフラッシュする間隔。
const LISTEN_FLUSH_MS = 5000

// listened_ms の DB 書き込みを担う。
// 現在再生中トラックの history 行 (rowid) の Promise を保持し、
// 曲頭で startPlay() を投げ、確定時 / フラッシュ時に await して updateListenedMs する。
// rowid そのものではなく Promise を持つことで、背景でイベントがまとめて replay
// されても「開始 INSERT がまだ解決していない曲」を取りこぼさない。
export class ListenTracker {
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
