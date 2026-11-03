import { afterEach, describe, expect, it, vi } from 'vitest'
import { getIdenticonColors, hashString, rollHue } from './playlistIcon'

describe('getIdenticonColors', () => {
  it('fg/bg を返す', () => {
    expect(getIdenticonColors(210)).toEqual({
      fg: 'hsl(210 65% 50%)',
      bg: 'hsl(210 25% 95%)',
    })
  })
})

describe('hashString', () => {
  it('FNV-1a 32bit の既知の値と一致する', () => {
    expect(hashString('')).toBe(2166136261)
    expect(hashString('a')).toBe(3826002220)
    expect(hashString('foobar')).toBe(3214735720)
  })

  it('同じ文字列には同じ値を返す', () => {
    expect(hashString('ロック')).toBe(hashString('ロック'))
  })

  it('常に符号なし32bitの範囲に収まる', () => {
    for (const s of ['', 'a', 'playlist', 'ロック', '🎵']) {
      const h = hashString(s)
      expect(h).toBeGreaterThanOrEqual(0)
      expect(h).toBeLessThanOrEqual(0xffffffff)
      expect(Number.isInteger(h)).toBe(true)
    }
  })
})

describe('rollHue', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('0〜359 を返す', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    expect(rollHue()).toBe(0)

    vi.spyOn(Math, 'random').mockReturnValue(0.9999999)
    expect(rollHue()).toBe(359)
  })

  it('前の hue から 60〜299 度ずらす', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    expect(rollHue(100)).toBe(160)

    vi.spyOn(Math, 'random').mockReturnValue(0.9999999)
    expect(rollHue(100)).toBe(39)
  })

  it('360 を超えたら折り返す', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    expect(rollHue(350)).toBe(50)
  })

  it('前の hue と色相環上で 60 度以上離れる', () => {
    for (const prev of [0, 90, 180, 300, 359]) {
      for (const r of [0, 0.25, 0.5, 0.75, 0.9999999]) {
        vi.spyOn(Math, 'random').mockReturnValue(r)
        const next = rollHue(prev)
        const diff = Math.abs(next - prev)
        expect(next).toBeGreaterThanOrEqual(0)
        expect(next).toBeLessThanOrEqual(359)
        expect(Math.min(diff, 360 - diff)).toBeGreaterThanOrEqual(60)
      }
    }
  })
})
