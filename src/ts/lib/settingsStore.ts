// ts/lib/settingsStore.ts
import { create } from 'zustand'
import { invoke } from '@tauri-apps/api/core'

export const AVAILABLE_LANGS = ['en', 'ja'] as const
export const DEFAULT_LANG: Lang = AVAILABLE_LANGS[0] // 'en'
export type Lang = typeof AVAILABLE_LANGS[number]

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
  crossfadeMode: 'normal' | 'cross_fade',
  fadeoutMs: number,
  isTrailingSilence: boolean,
  setMasterVolume: (value: number) => Promise<void>
  setIsNormalizeVolume: (value: boolean) => Promise<void>
  setCrossfadeMode: (value: 'normal' | 'cross_fade') => Promise<void>
  setFadeoutMs: (value: number) => Promise<void>
  setIsTrailingSilence: (value: boolean) => Promise<void>
  loadPlaySettings: () => Promise<void>
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
  crossfadeMode: 'normal',
  fadeoutMs: 500,
  isTrailingSilence: true,

  setMasterVolume: async (value) => {
    set({ masterVolume: value })
    await invoke('settings_set', { key: 'masterVolume', value })
  },

  setIsNormalizeVolume: async (value) => {
    set({ isNormalizeVolume: value })
    await invoke('settings_set', { key: 'isNormalizeVolume', value })
  },

  setCrossfadeMode: async (value) => {
    set({ crossfadeMode: value })
    await invoke('settings_set', { key: 'crossfadeMode', value })
  },

  setFadeoutMs: async (value) => {
    set({ fadeoutMs: value })
    await invoke('settings_set', { key: 'fadeoutMs', value })
  },

  setIsTrailingSilence: async (value) => {
    set({ isTrailingSilence: value })
    await invoke('settings_set', { key: 'isTrailingSilence', value })
  },

  loadPlaySettings: async () => {
    const [masterVolume, isNormalizeVolume, crossfadeMode, fadeoutMs, isTrailingSilence] = await Promise.all([
      invoke<number | null>('settings_get', { key: 'masterVolume' }),
      invoke<boolean | null>('settings_get', { key: 'isNormalizeVolume' }),
      invoke<'normal' | 'cross_fade' | null>('settings_get', { key: 'crossfadeMode' }),
      invoke<number | null>('settings_get', { key: 'fadeoutMs' }),
      invoke<boolean | null>('settings_get', { key: 'isTrailingSilence' }),
    ])
    set({
      masterVolume: masterVolume ?? 1,
      isNormalizeVolume: isNormalizeVolume ?? true,
      crossfadeMode: crossfadeMode ?? 'normal',
      fadeoutMs: fadeoutMs ?? 500,
      isTrailingSilence: isTrailingSilence ?? true,
    })
  },
}))