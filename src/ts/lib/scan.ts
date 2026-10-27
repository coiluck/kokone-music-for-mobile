// 設定済みフォルダを全スキャン
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getScanFolders } from './scanFolders'
import { useScanStore, type ScanProgressPayload } from './scanStore'

export async function runStartupScan(): Promise<void> {
  const folders = await getScanFolders()
  // if (folders.length === 0) return

  const { setScanningFlag, setScanProgress, notifyScanCompleted } = useScanStore.getState()
  setScanningFlag(true)

  const unlisten = await listen<ScanProgressPayload>(
    'scan-progress',
    ({ payload }) => {
      setScanProgress(payload)
    }
  )

  try {
    const added = await invoke<number>('music_scan_folders', { paths: folders })
    console.log(`スキャン完了: ${added}件追加`)
    notifyScanCompleted()
  } catch (e) {
    console.error('スキャン失敗:', e)
    setScanningFlag(false)
  } finally {
    unlisten()
  }
}
