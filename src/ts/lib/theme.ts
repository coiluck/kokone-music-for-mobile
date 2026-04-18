// ts/lib/theme.ts
import { invoke } from '@tauri-apps/api/core'

export interface ThemeSettings {
  accentColor: string
  bgColor: string
  bgMildColor: string
  textColor: string
  font: 'mamelon' | 'm-plus-rounded' | 'noto-sans-ja' | 'noto-serif'
}

const fontFamilyMap: Record<ThemeSettings['font'], string> = {
  'mamelon':        '"Mamelon", sans-serif',
  'm-plus-rounded': '"M-PLUS-Rounded-1c", sans-serif',
  'noto-sans-ja':   '"Noto-Sans-JP", sans-serif',
  'noto-serif':     '"Noto-Serif-JP", serif',
}

export const DEFAULTS: ThemeSettings = {
  accentColor: '#ff7f7e',
  bgColor: '#0a0f1e',
  bgMildColor: '#2a2a36',
  textColor: '#f0f0f0',
  font: 'mamelon',
}

/** CSS カスタムプロパティへ反映する */
export function applyTheme(settings: Partial<ThemeSettings>) {
  const merged = { ...DEFAULTS, ...settings }
  const root = document.documentElement
  root.style.setProperty('--color-accent',   merged.accentColor)
  root.style.setProperty('--color-bg',       merged.bgColor)
  root.style.setProperty('--color-bg-mild',  merged.bgMildColor)
  root.style.setProperty('--color-text',     merged.textColor)
  root.style.setProperty('--font-family',    fontFamilyMap[merged.font])
}

/** settings.json から読み込んで CSS へ適用する（起動時に呼ぶ） */
export async function loadAndApplyTheme() {
  const [accentColor, bgColor, font] = await Promise.all([
    invoke<string | null>('settings_get', { key: 'accentColor' }),
    invoke<string | null>('settings_get', { key: 'bgColor' }),
    invoke<ThemeSettings['font'] | null>('settings_get', { key: 'font' }),
  ])
  const bg = bgColor ?? DEFAULTS.bgColor
  applyTheme({
    accentColor: accentColor ?? DEFAULTS.accentColor,
    bgColor: bg,
    bgMildColor: makeMildBg(bg, judgeBrightness(bg) ? 'darker' : 'lighter'),
    textColor: judgeBrightness(bg) ? '#000' : '#fff',
    font: font ?? DEFAULTS.font,
  })
}

/** 項目変更して保存＋即時反映する */
export async function saveThemeKey<K extends keyof ThemeSettings>(
  key: K,
  value: ThemeSettings[K]
) {
  await invoke('settings_set', { key, value })
  // CSS 変数マッピング
  const propMap: Record<keyof ThemeSettings, string> = {
    accentColor:  '--color-accent',
    bgColor:      '--color-bg',
    bgMildColor:  '--color-bg-mild',
    textColor:    '--color-text',
    font:         '--font-family',
  }
  // font だけ値の変換が必要
  const cssValue = key === 'font'
    ? fontFamilyMap[value as ThemeSettings['font']]
    : value as string
  document.documentElement.style.setProperty(propMap[key], cssValue)
}

/** 明るさを判断 */
export function judgeBrightness(color: string): boolean {
  const rgb = color.match(/\w\w/g)?.map(hex => parseInt(hex, 16)) ?? [0, 0, 0]; // [r, g, b]
  const brightness = (rgb[0] * 299 + rgb[1] * 587 + rgb[2] * 114) / 1000;
  return brightness > 128;
}

/** 明るさを調整して新しい色を生成 */
export function makeMildBg(baseColor: string, mode: 'lighter' | 'darker', percent = 8): string {
  // RGBに変換
  const rgb = baseColor.match(/\w\w/g)?.map(hex => parseInt(hex, 16)) ?? [0, 0, 0];
  const r = rgb[0] / 255;
  const g = rgb[1] / 255;
  const b = rgb[2] / 255;

  // HSLに変換
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0, l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }

  // 輝度を調整
  const adjustment = mode === 'lighter' ? percent / 100 : -(percent / 100);
  l = Math.max(0, Math.min(1, l + adjustment));

  // RGBに戻す
  let r2: number, g2: number, b2: number;
  if (s === 0) {
    r2 = g2 = b2 = l;
  } else {
    const hue2rgb = (p: number, q: number, t: number): number => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r2 = hue2rgb(p, q, h + 1 / 3);
    g2 = hue2rgb(p, q, h);
    b2 = hue2rgb(p, q, h - 1 / 3);
  }

  // 16進数に戻す
  const toHex = (x: number): string => Math.round(x * 255).toString(16).padStart(2, '0');
  return `#${toHex(r2)}${toHex(g2)}${toHex(b2)}`;
}