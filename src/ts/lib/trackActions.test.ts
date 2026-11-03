import { describe, expect, it, vi } from 'vitest'

// music/index.ts は import されただけで AudioContext を作る singleton を組み立てるため、
// node 環境で読めない。shuffle は player に触らないのでモックで十分。
vi.mock('./music', () => ({ musicPlayer: {} }))

const { shuffle } = await import('./trackActions')

describe('shuffle', () => {
  it('入力配列を破壊しない', () => {
    const input = [1, 2, 3, 4, 5]
    const result = shuffle(input)
    expect(input).toEqual([1, 2, 3, 4, 5])
    expect(result).not.toBe(input)
  })

  it('要素を落とさず、増やさない', () => {
    const input = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    expect([...shuffle(input)].sort((a, b) => a - b)).toEqual(input)
  })

  it('空配列・1要素はそのまま', () => {
    expect(shuffle([])).toEqual([])
    expect(shuffle([42])).toEqual([42])
  })

  it('全要素が動きうる（先頭が固定されない）', () => {
    // Fisher-Yates を i>0 で回すとき shuffled[0] を交換対象から外す実装ミスがあると
    // 先頭が絶対に動かなくなる。100回引いて一度も動かなければ失敗とみなす。
    const input = [1, 2, 3, 4, 5]
    const moved = Array.from({ length: 100 }, () => shuffle(input)[0] !== 1)
    expect(moved.some(Boolean)).toBe(true)
  })
})
