import { beforeEach, describe, expect, it, vi } from 'vitest'
import { addTrackToPlaylist, removeTrackFromPlaylist } from './playlists'

// tracks 列だけを持つ playlists テーブルの代わり
const table = vi.hoisted(() => ({ tracks: '[]' }))

vi.mock('./connection', () => ({
  getDb: async () => ({
    select: async () => [{ tracks: table.tracks }],
    execute: async (_sql: string, [tracks]: [string]) => { table.tracks = tracks },
  }),
}))

beforeEach(() => {
  table.tracks = '[1, 2]'
})

describe('addTrackToPlaylist', () => {
  it('末尾に追加する', async () => {
    await addTrackToPlaylist(7, 3)
    expect(JSON.parse(table.tracks)).toEqual([1, 2, 3])
  })

  it('すでに入っている曲は増やさない', async () => {
    await addTrackToPlaylist(7, 2)
    expect(JSON.parse(table.tracks)).toEqual([1, 2])
  })
})

describe('removeTrackFromPlaylist', () => {
  it('指定した曲だけを外す', async () => {
    await removeTrackFromPlaylist(7, 1)
    expect(JSON.parse(table.tracks)).toEqual([2])
  })

  it('入っていない曲を指定しても変えない', async () => {
    await removeTrackFromPlaylist(7, 9)
    expect(JSON.parse(table.tracks)).toEqual([1, 2])
  })
})
