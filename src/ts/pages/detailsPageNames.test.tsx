// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import type { ReactElement } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AlbumDetailsPage from './AlbumDetailsPage'
import ArtistsDetailsPage from './ArtistsDetailsPage'
import PlaylistsDetailsPage from './PlaylistsDetailsPage'

const mocks = vi.hoisted(() => ({
  getAllTracks: vi.fn(),
  getAlbumTracks: vi.fn(),
  getPlaylists: vi.fn(),
  getPlaylistTracks: vi.fn(),
}))

vi.mock('../lib/db', () => ({
  ...mocks,
  getHistory: vi.fn(),
  getRecommended: vi.fn(),
  setPlaylistIcon: vi.fn(),
}))
vi.mock('../lib/trackActions', () => ({ playFromList: vi.fn(), playAll: vi.fn(), shufflePlay: vi.fn() }))
vi.mock('../lib/music', () => ({ musicPlayer: {} }))
vi.mock('../lib/i18n', () => ({
  useMappedTranslations: (mapping: Record<string, string>) => mapping,
}))
vi.mock('../components/MusicItem', () => ({
  default: ({ trackId }: { trackId: number }) => <p data-testid="track">{trackId}</p>,
}))
vi.mock('./PlaylistsPage', () => ({ DISPLAY_NAMES: {} }))

function renderAt(prefix: string, name: string, page: ReactElement) {
  render(
    <MemoryRouter initialEntries={[`/${prefix}/${encodeURIComponent(name)}`]}>
      <Routes><Route path={`/${prefix}/:name`} element={page} /></Routes>
    </MemoryRouter>
  )
}

const title = () => document.querySelector('.dh-component-title')?.textContent

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(cleanup)

// % 単体はデコードできず、%20 はデコードすると別の名前になる
describe.each(['100%', 'a%20b', '朝 の/通勤'])('名前が %s の詳細ページ', name => {
  it('アーティストの曲を出す', async () => {
    mocks.getAllTracks.mockResolvedValue([
      { id: 1, title: 'あ', artist: name },
      { id: 2, title: 'い', artist: 'other' },
    ])
    renderAt('artist', name, <ArtistsDetailsPage />)
    await screen.findByTestId('track')
    expect(screen.getAllByTestId('track').map(el => el.textContent)).toEqual(['1'])
    expect(title()).toBe(name)
  })

  it('アルバムの曲を名前どおりに取得する', async () => {
    mocks.getAlbumTracks.mockResolvedValue([{ id: 1, title: 'あ' }])
    renderAt('album', name, <AlbumDetailsPage />)
    await screen.findByTestId('track')
    expect(mocks.getAlbumTracks).toHaveBeenCalledWith(name)
    expect(title()).toBe(name)
  })

  it('プレイリストを名前どおりに見つける', async () => {
    mocks.getPlaylists.mockResolvedValue([
      { id: 7, name, trackIds: [1], icon: { kind: 'auto', hue: 0 } },
    ])
    mocks.getPlaylistTracks.mockResolvedValue([{ id: 1, title: 'あ' }])
    renderAt('playlists', name, <PlaylistsDetailsPage />)
    await waitFor(() => expect(mocks.getPlaylistTracks).toHaveBeenCalledWith([1]))
    expect(title()).toBe(name)
  })
})
