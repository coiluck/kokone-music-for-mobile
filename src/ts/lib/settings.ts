// settings.json の読み書きはすべてここを通す。
import { invoke } from '@tauri-apps/api/core'
import type { CloudflareD1Config, FirebaseConfig, HistoryBackend } from './settingsStore'
import type { ThemeSettings } from './theme'

// 保存しているキーと値の型
export interface SettingValues extends ThemeSettings {
  iconStyle: 'fill' | 'outline'
  ignoreMode: boolean
  ignoreTime: number // seconds
  lang: string
  masterVolume: number
  isNormalizeVolume: boolean
  disableAnalysingLoudness: boolean
  isTrailingSilence: boolean
  isDeveloperMode: boolean
  isSendHistory: boolean
  historyBackend: HistoryBackend
  firebaseConfig: FirebaseConfig
  cloudflareD1Config: CloudflareD1Config
  'scan-folders': string[]
}

export type SettingKey = keyof SettingValues

// 未保存のキーは null
export function getSetting<K extends SettingKey>(key: K): Promise<SettingValues[K] | null> {
  return invoke<SettingValues[K] | null>('settings_get', { key })
}

export async function setSetting<K extends SettingKey>(key: K, value: SettingValues[K]): Promise<void> {
  await invoke('settings_set', { key, value })
}
