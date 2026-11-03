// 設定済みフォルダを全スキャン
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getScanFolders } from './scanFolders'
import { useScanStore, type ScanProgressPayload } from './scanStore'

// music_scan_folders の戻り値 (src-tauri/src/scan/mod.rs の ScanResult)
interface ScanResult {
  added: number
  // 解析の依頼番号。解析しないときは 0
  analysis: number
}

// 重なって走っているスキャンの数。全部終わるまで scanning を下ろさない
let running = 0
// そのうちコマンドがまだ返っていない (途中の) スキャンの数
let scanPhase = 0

export async function runStartupScan(): Promise<void> {
  const folders = await getScanFolders()
  // if (folders.length === 0) return

  const { setScanningFlag, setScanProgress, notifyScanCompleted } = useScanStore.getState()
  running++
  scanPhase++
  setScanningFlag(true)

  const unlistenProgress = await listen<ScanProgressPayload>(
    'scan-progress',
    ({ payload }) => {
      // 列挙〜追加の途中
      if (scanPhase > 0 && payload.process_step === 'analyzing') return
      setScanProgress(payload)
    }
  )
  // 解析はコマンドが返った後もバックグラウンドで続く。完了イベントにはどの依頼番号まで解析したかが載る。
  // 完了がコマンドの戻りより先に届くこともあるので、invoke の前に待ち受ける
  let analyzedThrough = 0
  let ticket = Infinity
  let resolveAnalyzed!: () => void
  const analyzed = new Promise<void>(resolve => { resolveAnalyzed = resolve })
  const checkAnalyzed = () => { if (analyzedThrough >= ticket) resolveAnalyzed() }
  const unlistenAnalyzed = await listen<number>('scan-analyze-completed', ({ payload }) => {
    analyzedThrough = Math.max(analyzedThrough, payload)
    checkAnalyzed()
  })

  try {
    const { added, analysis } = await invoke<ScanResult>('music_scan_folders', { paths: folders })
      .finally(() => scanPhase--)
    console.log(`スキャン完了: ${added}件追加`)
    notifyScanCompleted()
    ticket = analysis
    checkAnalyzed()
    await analyzed
  } catch (e) {
    console.error('スキャン失敗:', e)
  } finally {
    unlistenProgress()
    unlistenAnalyzed()
    if (--running === 0) setScanningFlag(false)
  }
}
