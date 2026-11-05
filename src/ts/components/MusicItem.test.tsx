// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Track } from '../lib/db'
import { useTrackStore } from '../lib/trackStore'
import MusicItem from './MusicItem'
import PlaylistAddButton from './PlaylistAddButton'

vi.mock('../lib/db', () => ({}))
vi.mock('../lib/music', () => ({ musicPlayer: {} }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('../lib/i18n', () => ({
  useMappedTranslations: (mapping: Record<string, string>) => mapping,
}))

afterEach(cleanup)

describe('MusicItem の action', () => {
  it('渡したボタンを ⋮ の手前に描画する', () => {
    const track = { id: 1, title: 'あ', artist: 'a', tags: [] as string[] } as Track
    useTrackStore.setState({ tracksById: { 1: track } })

    render(<MusicItem trackId={1} onPlay={() => {}} action={<span>extra</span>} />)

    const extra = screen.getByText('extra')
    expect(extra.parentElement?.className).toBe('mi-component-actions-container')
    expect(extra.nextElementSibling?.className).toBe('mi-component-actions')
  })

  it('追加ボタンを押しても行の再生は動かず、行を押すと再生する', async () => {
    const track = { id: 1, title: 'あ', artist: 'a', tags: [] as string[] } as Track
    useTrackStore.setState({ tracksById: { 1: track } })
    const onPlay = vi.fn()
    const onToggle = vi.fn(async () => {})

    render(
      <MusicItem
        trackId={1}
        onPlay={onPlay}
        action={<PlaylistAddButton trackId={1} initialAdded={false} onToggle={onToggle} />}
      />
    )

    const button = screen.getByRole('button')
    fireEvent.click(button)
    await waitFor(() => expect(button.getAttribute('aria-pressed')).toBe('true'))
    expect(onToggle).toHaveBeenCalledWith(1, true)
    expect(onPlay).not.toHaveBeenCalled()

    fireEvent.click(screen.getByText('あ'))
    expect(onPlay).toHaveBeenCalledWith(1)
  })
})
