// ts/lib/settingsStore.ts
import { create } from 'zustand'
import { invoke } from '@tauri-apps/api/core'

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
  isTrailingSilence: boolean,
  setMasterVolume: (value: number) => Promise<void>
  setIsNormalizeVolume: (value: boolean) => Promise<void>
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

export const useSettingsStore = create<SettingsState>((set) => ({
  iconStyle: 'fill',

  setIconStyle: async (style) => {
    set({ iconStyle: style })
    await invoke('settings_set', { key: 'iconStyle', value: style })
  },

  loadIconSettings: async () => {
    const iconStyle = await invoke<'fill' | 'outline' | null>('settings_get', { key: 'iconStyle' })
    set({ iconStyle: iconStyle ?? 'fill' })
  },

  ignoreMode: false,
  ignoreTime: 0,

  setIgnoreMode: async (value) => {
    set({ ignoreMode: value })
    await invoke('settings_set', { key: 'ignoreMode', value })
  },

  setIgnoreTime: async (value) => {
    set({ ignoreTime: value })
    await invoke('settings_set', { key: 'ignoreTime', value })
  },

  loadScanIgnoreSettings: async () => {
    const [ignoreMode, ignoreTime] = await Promise.all([
      invoke<boolean | null>('settings_get', { key: 'ignoreMode' }),
      invoke<number | null>('settings_get', { key: 'ignoreTime' }),
    ])
    set({
      ignoreMode: ignoreMode ?? false,
      ignoreTime: ignoreTime ?? 0,
    })
  },

  lang: DEFAULT_LANG,

  setLang: async (lang) => {
    set({ lang })
    await invoke('settings_set', { key: 'lang', value: lang })
  },

  loadLang: async () => {
    const saved = await invoke<string | null>('settings_get', { key: 'lang' })
    if (saved && (AVAILABLE_LANGS as readonly string[]).includes(saved)) {
      set({ lang: saved as Lang })
    } else {
      // 未設定ならOSのロケールを取得
      const osLang = await invoke<string>('get_system_lang')
      const lang = (AVAILABLE_LANGS as readonly string[]).includes(osLang)
        ? (osLang as Lang)
        : DEFAULT_LANG
      set({ lang })
    }
  },

  masterVolume: 1,
  isNormalizeVolume: true,
  isTrailingSilence: true,

  setMasterVolume: async (value) => {
    set({ masterVolume: value })
    await invoke('settings_set', { key: 'masterVolume', value })
  },

  setIsNormalizeVolume: async (value) => {
    set({ isNormalizeVolume: value })
    await invoke('settings_set', { key: 'isNormalizeVolume', value })
  },

  setIsTrailingSilence: async (value) => {
    set({ isTrailingSilence: value })
    await invoke('settings_set', { key: 'isTrailingSilence', value })
  },

  loadPlaySettings: async () => {
    const [masterVolume, isNormalizeVolume, isTrailingSilence] = await Promise.all([
      invoke<number | null>('settings_get', { key: 'masterVolume' }),
      invoke<boolean | null>('settings_get', { key: 'isNormalizeVolume' }),
      invoke<boolean | null>('settings_get', { key: 'isTrailingSilence' }),
    ])
    set({
      masterVolume: masterVolume ?? 1,
      isNormalizeVolume: isNormalizeVolume ?? true,
      isTrailingSilence: isTrailingSilence ?? true,
    })
  },

  // ---- 開発者モード ----
  isDeveloperMode: false,
  isSendHistory: false,
  historyBackend: 'firebase',
  firebaseConfig: DEFAULT_FIREBASE_CONFIG,
  cloudflareD1Config: DEFAULT_CLOUDFLARE_D1_CONFIG,

  setIsDeveloperMode: async (value) => {
    set({ isDeveloperMode: value })
    await invoke('settings_set', { key: 'isDeveloperMode', value })
  },

  setIsSendHistory: async (value) => {
    set({ isSendHistory: value })
    await invoke('settings_set', { key: 'isSendHistory', value })
  },

  setHistoryBackend: async (value) => {
    set({ historyBackend: value })
    await invoke('settings_set', { key: 'historyBackend', value })
  },

  setFirebaseConfig: async (value) => {
    set({ firebaseConfig: value })
    await invoke('settings_set', { key: 'firebaseConfig', value })
  },

  setCloudflareD1Config: async (value) => {
    set({ cloudflareD1Config: value })
    await invoke('settings_set', { key: 'cloudflareD1Config', value })
  },

  loadDeveloperSettings: async () => {
    const [
      isDeveloperMode,
      isSendHistory,
      historyBackend,
      firebaseConfig,
      cloudflareD1Config,
    ] = await Promise.all([
      invoke<boolean | null>('settings_get', { key: 'isDeveloperMode' }),
      invoke<boolean | null>('settings_get', { key: 'isSendHistory' }),
      invoke<HistoryBackend | null>('settings_get', { key: 'historyBackend' }),
      invoke<FirebaseConfig | null>('settings_get', { key: 'firebaseConfig' }),
      invoke<CloudflareD1Config | null>('settings_get', { key: 'cloudflareD1Config' }),
    ])
    set({
      isDeveloperMode: isDeveloperMode ?? false,
      isSendHistory: isSendHistory ?? false,
      historyBackend: historyBackend ?? 'firebase',
      firebaseConfig: firebaseConfig ?? DEFAULT_FIREBASE_CONFIG,
      cloudflareD1Config: cloudflareD1Config ?? DEFAULT_CLOUDFLARE_D1_CONFIG,
    })
  },
}))