// SVGごとのプレースホルダー（実際は`__${key}__`の形で入っている）
export const SVG_COLOR_KEYS = {
  icon1: ['color1', 'color2', 'color3', 'color4'],
  icon2: ['color1', 'color2', 'color3'],
  icon3: ['color1', 'color2', 'color3'],
} as const

export type SvgIconName = keyof typeof SVG_COLOR_KEYS
export const SVG_NAMES: SvgIconName[] = ['icon1', 'icon2', 'icon3']

// DBに保存される形
export type PlaylistIcon =
  | { kind: 'svg'; name: SvgIconName; hue: number }
  | { kind: 'auto'; hue: number }

// SVGごとの色
const schemes: Record<SvgIconName, (h: number) => Record<string, string>> = {
  icon1: h => ({
    color1: `hsl(${(h - 10)}, 50%, 88%)`,
    color2: `hsl(${h}, 55%, 78%)`,
    color3: `hsl(${(h + 180) % 360}, 60%, 85%)`,
    color4: `hsl(${(h + 170) % 360}, 55%, 70%)`,
  }),
  icon2: h => ({
    color1: `hsl(${h}, 75%, 88%)`,
    color2: `hsl(${(h - 30) % 360}, 60%, 55%)`,
    color3: `hsl(${(h + 30) % 360}, 70%, 60%)`,
    color4: `hsl(${(h + 120) % 360}, 70%, 92%)`,
  }),
  icon3: h => ({
    color1: `hsl(${h}, 60%, 80%)`,
    color2: `hsl(${(h + 60) % 360}, 70%, 70%)`,
    color3: `hsl(${(h + 120) % 360}, 65%, 60%)`,
  }),
}

export function getSvgColors(name: SvgIconName, hue: number): Record<string, string> {
  return schemes[name](hue)
}

// identicon用の色（fg/bgの2色）
export function getIdenticonColors(hue: number): { fg: string; bg: string } {
  return {
    fg: `hsl(${hue} 65% 50%)`,
    bg: `hsl(${hue} 25% 95%)`,
  }
}

// hue だけサイコロ
export function rollHue(): number {
  return Math.floor(Math.random() * 360)
}

// FNV-1a 32bit ハッシュ（identicon用）
export function hashString(str: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}