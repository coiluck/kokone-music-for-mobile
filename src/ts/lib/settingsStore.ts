// ts/lib/settingsStore.ts
import { create } from 'zustand'
import { invoke } from '@tauri-apps/api/core'

interface SettingsState {
  iconStyle: 'fill' | 'outline'
  setIconStyle: (style: 'fill' | 'outline') => Promise<void>
  loadIconSettings: () => Promise<void>
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
}))