import { beforeEach, describe, expect, it, vi } from 'vitest'

const startPlay = vi.fn(async (_trackId: number) => 100)
const updateListenedMs = vi.fn(async (_historyId: number, _ms: number) => {})
vi.mock('../db', () => ({ startPlay, updateListenedMs }))

const { ListenTracker } = await import('./listenTracker')

// write は Promise の then で走るので、マイクロタスクを流してから確かめる
const settle = () => new Promise(resolve => setTimeout(resolve, 0))

beforeEach(() => {
  startPlay.mockClear()
  updateListenedMs.mockClear()
})

describe('ListenTracker', () => {
  it('begin で history 行を作り、finalize で確定値を書く', async () => {
    const t = new ListenTracker('test')
    t.begin(7)
    t.finalize(1234)
    await settle()
    expect(startPlay).toHaveBeenCalledWith(7)
    expect(updateListenedMs).toHaveBeenCalledWith(100, 1234)
  })

  it('flush は 5 秒ぶん進むごとに 1 回だけ書く', async () => {
    const t = new ListenTracker('test')
    t.begin(7)
    t.flush(4999)
    t.flush(5000)
    t.flush(9999)
    t.flush(10000)
    await settle()
    expect(updateListenedMs.mock.calls.map(c => c[1])).toEqual([5000, 10000])
  })

  it('begin 前や finalize 後は書かない', async () => {
    const t = new ListenTracker('test')
    t.flush(60000)
    t.finalize(60000)
    t.begin(7)
    t.finalize(10)
    t.finalize(20)
    await settle()
    expect(updateListenedMs.mock.calls.map(c => c[1])).toEqual([10])
  })

  it('開始 INSERT が終わる前に確定しても、その曲の行に書く', async () => {
    let resolveFirst!: (id: number) => void
    startPlay.mockImplementationOnce(() => new Promise(r => { resolveFirst = r }))
    const t = new ListenTracker('test')
    t.begin(1)
    t.finalize(3000)
    t.begin(2)
    t.finalize(4000)
    resolveFirst(50)
    await settle()
    expect(updateListenedMs).toHaveBeenCalledWith(50, 3000)
    expect(updateListenedMs).toHaveBeenCalledWith(100, 4000)
  })
})
