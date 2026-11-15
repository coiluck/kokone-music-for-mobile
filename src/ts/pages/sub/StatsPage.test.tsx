// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TopListening, Track } from '../../lib/db'
import StatsPage from './StatsPage'

const db = vi.hoisted(() => ({
  getListeningClock: vi.fn(),
  getListeningHeatmap: vi.fn(),
  getTotalListeningMs: vi.fn(),
  getTopListening: vi.fn(),
}))

vi.mock('../../lib/db', () => db)
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('../../lib/i18n', () => ({
  useMappedTranslations: (mapping: Record<string, string>) => ({
    ...mapping,
    playsOne: '1回',
    playsOther: '{count}回',
  }),
}))
vi.mock('../../components/HeaderSub', () => ({ default: () => null }))

const track = (id: number, title: string) => ({ id, title, artist: `a${id}`, tags: [] }) as unknown as Track

async function renderPage(top: TopListening) {
  db.getTopListening.mockResolvedValue(top)
  render(<MemoryRouter><StatsPage /></MemoryRouter>)
  // 全ての読み込みが終わるまで待つ
  await screen.findAllByText('stats.clocks.caption.tracks')
}

const radarTexts = (className: string) =>
  [...document.querySelectorAll(`.${className}`)].map(el => el.textContent)

beforeEach(() => {
  vi.clearAllMocks()
  db.getListeningClock.mockResolvedValue({ streams: new Array(24).fill(0), minutes: new Array(24).fill(0) })
  db.getListeningHeatmap.mockResolvedValue([])
  db.getTotalListeningMs.mockResolvedValue(0)
})

afterEach(cleanup)

describe('よく聴いた曲', () => {
  it('順位と再生回数を表示し、バーは1位を100%とする', async () => {
    await renderPage({
      tracks: [{ track: track(1, 'あ'), count: 10 }, { track: track(2, 'い'), count: 5 }],
      tags: [],
    })

    const rows = [...document.querySelectorAll<HTMLElement>('.stats-top-track')]
    expect(rows.map(row => row.querySelector('.stats-top-track-title')?.textContent)).toEqual(['あ', 'い'])
    expect(rows.map(row => row.querySelector('.stats-top-track-rank')?.textContent)).toEqual(['1', '2'])
    expect(rows.map(row => row.querySelector<HTMLElement>('.stats-top-track-bar div')?.style.width))
      .toEqual(['100%', '50%'])
    expect(rows[1].querySelector('.stats-top-track-count')?.textContent).toBe('5回')
  })

  it('再生が1回なら単数形の翻訳を使う', async () => {
    await renderPage({ tracks: [{ track: track(1, 'あ'), count: 1 }], tags: [] })

    expect(document.querySelector('.stats-top-track-count')?.textContent).toBe('1回')
  })

  it('履歴がなければ見出しごと出さない', async () => {
    await renderPage({ tracks: [], tags: [] })

    expect(document.querySelector('.stats-top-tracks')).toBeNull()
    expect(screen.queryByText('stats.topTracks.title')).toBeNull()
  })
})

describe('よく聴いたタグ', () => {
  it('6件に足りない軸は --- と 0 で埋める', async () => {
    await renderPage({ tracks: [], tags: [{ tag: '静', count: 8 }, { tag: '明', count: 3 }] })

    expect(document.querySelectorAll('.stats-radar-spoke')).toHaveLength(6)
    expect(radarTexts('stats-radar-label').filter(label => label === '---')).toHaveLength(4)
    expect(radarTexts('stats-radar-count').filter(count => count === '0回')).toHaveLength(4)
    expect(document.querySelectorAll('.stats-radar-dot')).toHaveLength(2)
  })

  it('軸は名前順に置く', async () => {
    await renderPage({
      tracks: [],
      tags: [
        { tag: 'う', count: 9 }, { tag: 'あ', count: 8 }, { tag: 'い', count: 7 },
        { tag: 'か', count: 6 }, { tag: 'お', count: 5 }, { tag: 'え', count: 4 },
      ],
    })

    expect(radarTexts('stats-radar-label')).toEqual(['あ', 'い', 'う', 'え', 'お', 'か'])
  })

  it('長いタグはラベルを切り詰める', async () => {
    await renderPage({ tracks: [], tags: [{ tag: 'ドライブ中に聴きたい曲', count: 8 }] })

    expect(radarTexts('stats-radar-label')[0]).toBe('ドライブ中に…')
  })

  it('タグがなければ見出しごと出さない', async () => {
    await renderPage({ tracks: [], tags: [] })

    expect(document.querySelector('.stats-radar')).toBeNull()
    expect(screen.queryByText('stats.topTags.title')).toBeNull()
  })
})
