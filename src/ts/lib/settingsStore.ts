// ts/lib/settingsStore.ts
import { create } from 'zustand'
import { invoke } from '@tauri-apps/api/core'

interface SettingsState {
  iconStyle: 'fill' | 'outline'
  setIconStyle: (style: 'fill' | 'outline') => Promise<void>
  loadIconSettings: () => Promise<void>

  ignoreMode: boolean
  ignoreTime: number // seconds
  setIgnoreMode: (value: boolean) => Promise<void>
  setIgnoreTime: (value: number) => Promise<void>
  loadScanIgnoreSettings: () => Promise<void>
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
}))