// DBに保存される形
export type PlaylistIcon = { kind: 'auto'; hue: number }

// identicon用の色（fg/bgの2色）
export function getIdenticonColors(hue: number): { fg: string; bg: string } {
  return {
    fg: `hsl(${hue} 65% 50%)`,
    bg: `hsl(${hue} 25% 95%)`,
  }
}

// hue だけサイコロ
export function rollHue(prevHue?: number): number {
  if (prevHue !== undefined) {
    // 少し離れた色
    return Math.floor(prevHue + 60 + Math.random() * 240) % 360
  }
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