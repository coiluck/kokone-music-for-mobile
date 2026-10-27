import { platform } from '@tauri-apps/plugin-os'

// テスト (vitest) では false になる。
export function isAndroid(): boolean {
  try { return platform() === 'android' } catch { return false }
}
