import { beforeEach, describe, expect, it, vi } from 'vitest'

const execute = vi.fn(async (_sql: string) => ({ rowsAffected: 0, lastInsertId: 0 }))
const select = vi.fn(async () => [])
const load = vi.fn(async () => ({ execute, select }))
vi.mock('@tauri-apps/plugin-sql', () => ({ default: { load } }))

beforeEach(() => {
  vi.resetModules()
  load.mockClear()
  execute.mockClear()
})

const createTableCount = () =>
  execute.mock.calls.filter(([sql]) => String(sql).includes('CREATE TABLE IF NOT EXISTS tracks')).length

describe('getDb', () => {
  it('同時に呼ばれても接続とスキーマ作成は 1 回だけ', async () => {
    const { getDb, initDb } = await import('./connection')
    const [a, b] = await Promise.all([getDb(), getDb(), initDb()])
    expect(a).toBe(b)
    expect(load).toHaveBeenCalledTimes(1)
    expect(createTableCount()).toBe(1)
  })

  it('接続に失敗したら次の呼び出しでやり直す', async () => {
    const { getDb } = await import('./connection')
    load.mockRejectedValueOnce(new Error('locked'))
    await expect(getDb()).rejects.toThrow('locked')
    await expect(getDb()).resolves.toBeDefined()
    expect(load).toHaveBeenCalledTimes(2)
  })
})
