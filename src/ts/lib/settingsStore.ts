// ts/lib/settingsStore.ts
import { create } from 'zustand'
import { invoke } from '@tauri-apps/api/core'
import { getSetting, setSetting, type SettingValues } from './settings'

export const AVAILABLE_LANGS = ['en', 'ja'] as const
export const DEFAULT_LANG: Lang = AVAILABLE_LANGS[0] // 'en'
export type Lang = typeof AVAILABLE_LANGS[number]

export type HistoryBackend = 'firebase' | 'cloudflare-d1'

export interface FirebaseConfig {
  // Firestore REST API へ直接 POST する想定。
  //   POST https://firestore.googleapis.com/v1/projects/{projectId}/databases/(default)/documents/{collection}?key={apiKey}
  projectId: string
  apiKey: string
  collection: string
}

export interface CloudflareD1Config {
  // 任意の Cloudflare Worker エンドポイントへ JSON POST する想定。
  //   POST {endpoint}
  //   Header: Authorization: Bearer {apiToken}
  //   Body:   { title, artist, playedAt }
  endpoint: string
  apiToken: string
}

interface SettingsState {
  iconStyle: 'fill' | 'outline'
  setIconStyle: (style: 'fill' | 'outline') => Promise<void>
  loadIconSettings: () => Promise<void>

  ignoreMode: boolean
  ignoreTime: number // seconds
  setIgnoreMode: (value: boolean) => Promise<void>
  setIgnoreTime: (value: number) => Promise<void>
  loadScanIgnoreSettings: () => Promise<void>

  lang: Lang
  setLang: (lang: Lang) => Promise<void>
  loadLang: () => Promise<void>

  // 再生設定
  masterVolume: number,
  isNormalizeVolume: boolean,
  disableAnalysingLoudness: boolean,
  isTrailingSilence: boolean,
  setMasterVolume: (value: number) => Promise<void>
  setIsNormalizeVolume: (value: boolean) => Promise<void>
  setDisableAnalysingLoudness: (value: boolean) => Promise<void>
  setIsTrailingSilence: (value: boolean) => Promise<void>
  loadPlaySettings: () => Promise<void>

  // 開発者モード
  isDeveloperMode: boolean
  isSendHistory: boolean
  historyBackend: HistoryBackend
  firebaseConfig: FirebaseConfig
  cloudflareD1Config: CloudflareD1Config
  setIsDeveloperMode: (value: boolean) => Promise<void>
  setIsSendHistory: (value: boolean) => Promise<void>
  setHistoryBackend: (value: HistoryBackend) => Promise<void>
  setFirebaseConfig: (value: FirebaseConfig) => Promise<void>
  setCloudflareD1Config: (value: CloudflareD1Config) => Promise<void>
  loadDeveloperSettings: () => Promise<void>
}

const DEFAULT_FIREBASE_CONFIG: FirebaseConfig = {
  projectId: '',
  apiKey: '',
  collection: 'play_history',
}

const DEFAULT_CLOUDFLARE_D1_CONFIG: CloudflareD1Config = {
  endpoint: '',
  apiToken: '',
}

function isLang(value: string | null): value is Lang {
  return value != null && (AVAILABLE_LANGS as readonly string[]).includes(value)
}

export const useSettingsStore = create<SettingsState>((set) => {
  const persisted = <K extends keyof SettingValues & keyof SettingsState>(key: K) =>
    async (value: SettingValues[K]) => {
      set({ [key]: value } as Partial<SettingsState>)
      await setSetting(key, value)
    }

  return {
    iconStyle: 'fill',
    setIconStyle: persisted('iconStyle'),

    loadIconSettings: async () => {
      set({ iconStyle: (await getSetting('iconStyle')) ?? 'fill' })
    },

    ignoreMode: false,
    ignoreTime: 0,
    setIgnoreMode: persisted('ignoreMode'),
    setIgnoreTime: persisted('ignoreTime'),

    loadScanIgnoreSettings: async () => {
      const [ignoreMode, ignoreTime] = await Promise.all([
        getSetting('ignoreMode'),
        getSetting('ignoreTime'),
      ])
      set({
        ignoreMode: ignoreMode ?? false,
        ignoreTime: ignoreTime ?? 0,
      })
    },

    lang: DEFAULT_LANG,
    setLang: persisted('lang'),

    loadLang: async () => {
      const saved = await getSetting('lang')
      if (isLang(saved)) {
        set({ lang: saved })
      } else {
        // 未設定ならOSのを取得
        const osLang = await invoke<string>('get_system_lang')
        set({ lang: isLang(osLang) ? osLang : DEFAULT_LANG })
      }
    },

    masterVolume: 1,
    isNormalizeVolume: true,
    disableAnalysingLoudness: false,
    isTrailingSilence: true,
    setMasterVolume: persisted('masterVolume'),
    setIsNormalizeVolume: persisted('isNormalizeVolume'),
    setDisableAnalysingLoudness: persisted('disableAnalysingLoudness'),
    setIsTrailingSilence: persisted('isTrailingSilence'),

    loadPlaySettings: async () => {
      const [masterVolume, isNormalizeVolume, disableAnalysingLoudness, isTrailingSilence] = await Promise.all([
        getSetting('masterVolume'),
        getSetting('isNormalizeVolume'),
        getSetting('disableAnalysingLoudness'),
        getSetting('isTrailingSilence'),
      ])
      set({
        masterVolume: masterVolume ?? 1,
        isNormalizeVolume: isNormalizeVolume ?? true,
        disableAnalysingLoudness: disableAnalysingLoudness ?? false,
        isTrailingSilence: isTrailingSilence ?? true,
      })
    },

    // 開発者モード
    isDeveloperMode: false,
    isSendHistory: false,
    historyBackend: 'firebase',
    firebaseConfig: DEFAULT_FIREBASE_CONFIG,
    cloudflareD1Config: DEFAULT_CLOUDFLARE_D1_CONFIG,
    setIsDeveloperMode: persisted('isDeveloperMode'),
    setIsSendHistory: persisted('isSendHistory'),
    setHistoryBackend: persisted('historyBackend'),
    setFirebaseConfig: persisted('firebaseConfig'),
    setCloudflareD1Config: persisted('cloudflareD1Config'),

    loadDeveloperSettings: async () => {
      const [
        isDeveloperMode,
        isSendHistory,
        historyBackend,
        firebaseConfig,
        cloudflareD1Config,
      ] = await Promise.all([
        getSetting('isDeveloperMode'),
        getSetting('isSendHistory'),
        getSetting('historyBackend'),
        getSetting('firebaseConfig'),
        getSetting('cloudflareD1Config'),
      ])
      set({
        isDeveloperMode: isDeveloperMode ?? false,
        isSendHistory: isSendHistory ?? false,
        historyBackend: historyBackend ?? 'firebase',
        firebaseConfig: firebaseConfig ?? DEFAULT_FIREBASE_CONFIG,
        cloudflareD1Config: cloudflareD1Config ?? DEFAULT_CLOUDFLARE_D1_CONFIG,
      })
    },
  }
})
