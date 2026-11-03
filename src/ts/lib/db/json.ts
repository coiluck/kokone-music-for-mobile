// JSON 文字列で保存している列 (tags / tracks / icon など) の復元
import type { PlaylistIcon } from '../playlistIcon'

// 配列にする。壊れた JSON や型の違う要素は捨てる
export function parseJsonArray<T>(json: string, guard: (v: unknown) => v is T): T[] {
  try {
    const parsed = JSON.parse(json)
    if (Array.isArray(parsed)) return parsed.filter(guard)
  } catch { /* noop */ }
  return []
}

export const isString = (v: unknown): v is string => typeof v === 'string'
export const isNumber = (v: unknown): v is number => typeof v === 'number'

// ランダムなhue (0-359)のidenticonアイコンを生成
export function createDefaultIcon(): PlaylistIcon {
  const hue = Math.floor(Math.random() * 360)
  return { kind: 'auto', hue }
}

// iconカラム (JSON文字列 or null) をPlaylistIconに復元する
export function parseIconJson(json: string | null): PlaylistIcon {
  if (!json) return createDefaultIcon()
  try { return JSON.parse(json) as PlaylistIcon }
  catch { return createDefaultIcon() }
}
