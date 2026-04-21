import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import { useScanStore, type ScanProgressPayload } from './scanStore'

// ---------------------------------------------------
// 設定ファイルに保存されたフォルダパスを取得
// ---------------------------------------------------
async function getScanFolders(): Promise<string[]> {
  const folders = await invoke<string[]>('settings_get', { key: 'scan-folders' })
  return folders ?? []
}

// ---------------------------------------------------
// ダイアログでフォルダを追加 → 設定に保存
// ---------------------------------------------------
export async function addScanFolder(): Promise<string | null> {
  const selected = await open({
    directory: true,
    multiple: false,
    title: 'スキャンするフォルダを選択',
  })
  if (!selected) return null

  const current = await getScanFolders()

  if (current.includes(selected as string)) return null

  const updated = [...current, selected as string]
  await invoke('settings_set', { key: 'scan-folders', value: updated })

  return selected as string
}

// ---------------------------------------------------
// 設定済みフォルダを全スキャン（起動時 & 手動更新時）
// ---------------------------------------------------
import { listen } from '@tauri-apps/api/event'

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