// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Track } from '../../lib/db'
import { usePlayerStore } from '../../lib/playerStore'
import { useSettingsStore } from '../../lib/settingsStore'
import { useTrackStore } from '../../lib/trackStore'
import QueuePage from './QueuePage'

const player = vi.hoisted(() => ({
  removeFromQueue: vi.fn(),
  setQueue: vi.fn(),
  play: vi.fn(),
  pushHistory: vi.fn(),
}))

vi.mock('../../lib/db', () => ({}))
vi.mock('../../lib/music', () => ({ musicPlayer: player }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('../../lib/i18n', () => ({
  useMappedTranslations: (mapping: Record<string, string>) => mapping,
}))
vi.mock('../../components/Icon', () => ({
  Icon: ({ name, mode }: { name: string; mode: string | null }) => (
    <i data-icon={name} data-mode={mode ?? ''} />
  ),
}))

const track = (id: number, title: string) =>
  ({ id, title, artist: 'a', tags: [] as string[] }) as Track
const tracks = [track(1, 'あ'), track(2, 'い'), track(3, 'う')]

const rows = () => [...document.querySelectorAll<HTMLElement>('.queue-page-item')]
const iconIn = (row: HTMLElement, name: string) =>
  row.querySelector<HTMLElement>(`[data-icon="${name}"]`)!

function renderPage() {
  return render(<MemoryRouter><QueuePage /></MemoryRouter>)
}

beforeEach(() => {
  vi.clearAllMocks()
  act(() => {
    useTrackStore.setState({ tracksById: Object.fromEntries(tracks.map(t => [t.id, t])) })
    usePlayerStore.setState({ queue: tracks, currentTrack: null })
    useSettingsStore.setState({ iconStyle: 'fill' })
  })
})

afterEach(cleanup)

describe('キューの削除ボタン', () => {
  it('押すとその位置の曲を消し、再生はしない', () => {
    renderPage()
    fireEvent.click(iconIn(rows()[1], 'remove'))
    expect(player.removeFromQueue).toHaveBeenCalledTimes(1)
    expect(player.removeFromQueue).toHaveBeenCalledWith(1)
    expect(player.play).not.toHaveBeenCalled()
    expect(player.setQueue).not.toHaveBeenCalled()
  })

  it('全ての行で ⋮ の手前に、設定のアイコンで出す', () => {
    renderPage()
    expect(rows()).toHaveLength(3)
    for (const row of rows()) {
      const remove = iconIn(row, 'remove')
      expect(remove.dataset.mode).toBe('fill')
      const order = remove.compareDocumentPosition(iconIn(row, 'ellipsis'))
      expect(order & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    }
  })

  it('同じ見た目のボタン枠に入っている', () => {
    renderPage()
    const remove = iconIn(rows()[0], 'remove').parentElement!
    const dots = iconIn(rows()[0], 'ellipsis').parentElement!
    expect(remove.className).toBe('mi-component-actions')
    expect(remove.parentElement).toBe(dots.parentElement)
  })
})

describe('キューの行', () => {
  it('行を押すと、その曲を再生して手前までをキューから除く', () => {
    renderPage()
    fireEvent.click(screen.getByText('い'))
    expect(player.setQueue).toHaveBeenCalledWith([tracks[2]])
    expect(player.play).toHaveBeenCalledWith(tracks[1])
    expect(player.removeFromQueue).not.toHaveBeenCalled()
  })

  it('⋮ を押すと曲のメニューを開く', () => {
    renderPage()
    fireEvent.click(iconIn(rows()[0], 'ellipsis'))
    expect(screen.getByText('music.item.actions.add-to-queue')).toBeTruthy()
    expect(player.removeFromQueue).not.toHaveBeenCalled()
  })
})
