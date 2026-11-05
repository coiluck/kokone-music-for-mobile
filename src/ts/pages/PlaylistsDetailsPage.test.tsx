// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import PlaylistsDetailsPage from './PlaylistsDetailsPage'

const mocks = vi.hoisted(() => ({
  getPlaylists: vi.fn(async () => [{ id: 7, name: '朝 の/通勤', trackIds: [], icon: { kind: 'auto', hue: 0 } }]),
  getPlaylistTracks: vi.fn(async () => []),
}))

vi.mock('../lib/db', () => ({
  getPlaylists: mocks.getPlaylists,
  getPlaylistTracks: mocks.getPlaylistTracks,
  getHistory: vi.fn(),
  getRecommended: vi.fn(),
  setPlaylistIcon: vi.fn(),
}))
vi.mock('../lib/trackActions', () => ({ playFromList: vi.fn(), playAll: vi.fn(), shufflePlay: vi.fn() }))
vi.mock('../lib/music', () => ({ musicPlayer: {} }))
vi.mock('../lib/i18n', () => ({
  useMappedTranslations: (mapping: Record<string, string>) => mapping,
}))
vi.mock('../components/MusicItem', () => ({ default: () => null }))
// PlaylistsPage は DISPLAY_NAMES のためだけに読み込まれる
vi.mock('./PlaylistsPage', () => ({
  DISPLAY_NAMES: { __history__: { ja: '履歴', en: 'History' } },
}))

function Destination() {
  return <p data-testid="path">{useLocation().pathname}</p>
}

afterEach(cleanup)

describe('PlaylistsDetailsPage の + ボタン', () => {
  it('そのプレイリストの追加ページを開く', async () => {
    const name = encodeURIComponent('朝 の/通勤')
    render(
      <MemoryRouter initialEntries={[`/playlists/${name}`]}>
        <Routes>
          <Route path="/playlists/:name" element={<PlaylistsDetailsPage />} />
          <Route path="/sub/playlists/:name/add" element={<Destination />} />
        </Routes>
      </MemoryRouter>
    )

    await waitFor(() => expect(mocks.getPlaylistTracks).toHaveBeenCalled())
    // + はボタン行の先頭
    fireEvent.click(document.querySelector('.dh-component-actions-left .dh-component-action')!)
    expect((await screen.findByTestId('path')).textContent).toBe(`/sub/playlists/${name}/add`)
  })
})
