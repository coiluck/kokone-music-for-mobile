import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import { useScanStore, type ScanProgressPayload } from './scanStore'

// ---------------------------------------------------
// プラットフォーム判定
// 旧 dialog API は Android ではフォルダピッカーが動かないため、
// addScanFolder のフロー自体を分岐する。
// ---------------------------------------------------
export function isAndroid(): boolean {
  if (typeof navigator === 'undefined') return false
  return /Android/i.test(navigator.userAgent)
}

// ---------------------------------------------------
// 設定ファイルに保存されたフォルダパスを取得
// ---------------------------------------------------
async function getScanFolders(): Promise<string[]> {
  const folders = await invoke<string[]>('settings_get', { key: 'scan-folders' })
  return folders ?? []
}

async function persistScanFolders(folders: string[]): Promise<void> {
  await invoke('settings_set', { key: 'scan-folders', value: folders })
}

// ---------------------------------------------------
// フォルダ追加 (desktop: dialog / Android: パス文字列を直接渡す)
// ---------------------------------------------------
/**
 * デスクトップ: ダイアログでフォルダを選ばせて scan-folders に追加する。
 * Android では呼んではいけない (戻り値 null)。Android は addScanFolderByPath を使う。
 */
export async function addScanFolder(): Promise<string | null> {
  if (isAndroid()) {
    console.warn('addScanFolder() is desktop-only on Android. Use addScanFolderByPath().')
    return null
  }

  const selected = await open({
    directory: true,
    multiple: false,
    title: 'スキャンするフォルダを選択',
  })
  if (!selected) return null

  const current = await getScanFolders()
  if (current.includes(selected as string)) return null

  await persistScanFolders([...current, selected as string])
  return selected as string
}

/**
 * Android: フォルダ選択モーダルで選んだパスを scan-folders に追加する。
 * 既に登録済み or 空文字なら null。
 */
export async function addScanFolderByPath(path: string): Promise<string | null> {
  if (!path) return null
  const current = await getScanFolders()
  if (current.includes(path)) return null
  await persistScanFolders([...current, path])
  return path
}

// ---------------------------------------------------
// Android: MediaStore 連携
// ---------------------------------------------------
export async function hasAudioPermission(): Promise<boolean> {
  try {
    return await invoke<boolean>('android_has_audio_permission')
  } catch (e) {
    console.error('android_has_audio_permission failed:', e)
    return false
  }
}

export async function requestAudioPermission(): Promise<void> {
  try {
    await invoke('android_request_audio_permission')
  } catch (e) {
    console.error('android_request_audio_permission failed:', e)
  }
}

/**
 * MediaStore に登録済みの音楽ファイルが置かれているフォルダ一覧 (絶対パス) を返す。
 * 権限が無い場合は空配列。
 */
export async function listAndroidAudioFolders(): Promise<string[]> {
  try {
    return await invoke<string[]>('android_list_audio_folders')
  } catch (e) {
    console.error('android_list_audio_folders failed:', e)
    return []
  }
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
