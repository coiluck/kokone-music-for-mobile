import { afterEach, describe, expect, it, vi } from 'vitest'
import { getIdenticonColors, getSvgColors, hashString, rollHue } from './playlistIcon'

describe('getSvgColors', () => {
  it('icon1 は hue を基準に4色を返す', () => {
    expect(getSvgColors('icon1', 100)).toEqual({
      color1: 'hsl(90, 50%, 88%)',
      color2: 'hsl(100, 55%, 78%)',
      color3: 'hsl(280, 60%, 85%)',
      color4: 'hsl(270, 55%, 70%)',
    })
  })

  it('icon3 は3色を返す', () => {
    expect(Object.keys(getSvgColors('icon3', 0))).toEqual(['color1', 'color2', 'color3'])
  })

  it('180度以上ずらす色は360で折り返す', () => {
    expect(getSvgColors('icon1', 200).color3).toBe('hsl(20, 60%, 85%)')
  })
})

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
})
