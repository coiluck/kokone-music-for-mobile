// Android: 音楽ファイルの読み取り権限と MediaStore 上のフォルダ一覧
import { invoke } from '@tauri-apps/api/core'
import {
  hasAudioPermission as pluginHasAudioPermission,
  requestAudioPermission as pluginRequestAudioPermission,
} from 'tauri-plugin-android-media-api'

export async function hasAudioPermission(): Promise<boolean> {
  try {
    return await pluginHasAudioPermission()
  } catch (e) {
    console.error('hasAudioPermission failed:', e)
    return false
  }
}

// ダイアログを出して、ユーザーの選択結果が返るまで待つ
// Tauri プラグインの onRequestPermissionsResult 経由で resolve する
export async function requestAudioPermission(): Promise<boolean> {
  try {
    return await pluginRequestAudioPermission()
  } catch (e) {
    console.error('requestAudioPermission failed:', e)
    return false
  }
}

// MediaStore に登録済みの音楽ファイルが置かれているフォルダ一覧 (絶対パス) を返す
export async function listAndroidAudioFolders(): Promise<string[]> {
  try {
    return await invoke<string[]>('android_list_audio_folders')
  } catch (e) {
    console.error('android_list_audio_folders failed:', e)
    return []
  }
}
