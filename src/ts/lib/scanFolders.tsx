import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import { useScanStore } from './scanStore'

// ---------------------------------------------------
// 設定ファイルに保存されたフォルダパスを取得
// ---------------------------------------------------
async function getScanFolders(): Promise<string[]> {
  // Rustコマンド経由でsettings.jsonの "scan-folders" キーを読む
  const folders = await invoke<string[]>('settings_get', { key: 'scan-folders' })
  return folders ?? []
}

// ---------------------------------------------------
// ダイアログでフォルダを追加 → 設定に保存
// SettingsPage.tsx の「フォルダを追加」ボタンから呼ぶ
// ---------------------------------------------------
export async function addScanFolder(): Promise<string | null> {
  const selected = await open({
    directory: true,
    multiple: false,
    title: 'スキャンするフォルダを選択',
  })
  if (!selected) return null

  const current = await getScanFolders()

  // 重複チェック
  if (current.includes(selected as string)) return null

  const updated = [...current, selected as string]
  await invoke('settings_set', { key: 'scan-folders', value: updated })

  return selected as string
}

// ---------------------------------------------------
// 設定済みフォルダを全スキャン（起動時 & 手動更新時）
// App.tsx の useEffect と SettingsPage の「今すぐスキャン」から呼ぶ
// ---------------------------------------------------
export async function runStartupScan(): Promise<void> {
  const folders = await getScanFolders()
  if (folders.length === 0) return

  // Rustコマンドでフォルダを再帰スキャン
  // 戻り値: 新規追加されたトラック数（スキップ済みは含まない）
  const { setScanningFlag, notifyScanCompleted } = useScanStore.getState()
  setScanningFlag(true)
  const added = await invoke<number>('music_scan_folders', { paths: folders })
  console.log(`スキャン完了: ${added}件追加`)
  notifyScanCompleted() 
}