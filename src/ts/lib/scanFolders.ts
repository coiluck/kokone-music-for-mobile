// スキャン対象フォルダの設定 (settings.json の scan-folders)
import { open } from '@tauri-apps/plugin-dialog'
import { isAndroid } from './platform'
import { getSetting, setSetting } from './settings'

export async function getScanFolders(): Promise<string[]> {
  return (await getSetting('scan-folders')) ?? []
}

// デスクトップ用
// ダイアログでフォルダを選ばせて scan-folders に追加
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
  return addScanFolderByPath(selected)
}

// Android 用
// フォルダのパスを scan-folders に追加する。Android はフォルダ選択モーダルで選ぶ
export async function addScanFolderByPath(path: string): Promise<string | null> {
  if (!path) return null
  const current = await getScanFolders()
  if (current.includes(path)) return null
  await setSetting('scan-folders', [...current, path])
  return path
}

// 削除後のフォルダ一覧を返す
export async function removeScanFolder(path: string): Promise<string[]> {
  const updated = (await getScanFolders()).filter(f => f !== path)
  await setSetting('scan-folders', updated)
  return updated
}
