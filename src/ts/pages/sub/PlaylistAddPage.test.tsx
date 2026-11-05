// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Track } from '../../lib/db'
import { usePlayerStore } from '../../lib/playerStore'
import PlaylistAddPage from './PlaylistAddPage'

const mocks = vi.hoisted(() => ({
  getAllTracks: vi.fn(),
  searchTracks: vi.fn(),
  getPlaylists: vi.fn(),
  addTrackToPlaylist: vi.fn(),
  removeTrackFromPlaylist: vi.fn(),
  playFromList: vi.fn(),
  showMessage: vi.fn(),
}))

vi.mock('../../lib/db', () => ({
  getAllTracks: mocks.getAllTracks,
  searchTracks: mocks.searchTracks,
  getPlaylists: mocks.getPlaylists,
  addTrackToPlaylist: mocks.addTrackToPlaylist,
  removeTrackFromPlaylist: mocks.removeTrackFromPlaylist,
}))
vi.mock('../../lib/trackActions', () => ({ playFromList: mocks.playFromList }))
vi.mock('../../components/Message', () => ({ showMessage: mocks.showMessage }))
vi.mock('../../lib/i18n', () => ({
  useMappedTranslations: (mapping: Record<string, string>) => mapping,
}))
vi.mock('../../components/MusicItem', () => ({
  // 本物と同じく、行の中にボタンがあり、行を押すと再生する
  default: ({ trackId, onPlay, action }: { trackId: number; onPlay: (id: number) => void; action: ReactNode }) => (
    <div data-testid={`row-${trackId}`} onClick={() => onPlay(trackId)}>{action}</div>
  ),
}))

const track = (id: number, title: string) => ({ id, title }) as Track
const button = (id: number) =>
  screen.getByTestId(`row-${id}`).querySelector<HTMLElement>('[role="button"]')!
const isAdded = (id: number) => button(id).getAttribute('aria-pressed') === 'true'
const input = () => screen.getByPlaceholderText('search.input.placeholder') as HTMLInputElement

function renderPage(name = '作業用') {
  return render(
    <MemoryRouter
      initialEntries={['/', `/sub/playlists/${encodeURIComponent(name)}/add`]}
      initialIndex={1}
    >
      <Routes>
        <Route path="/" element={<p>details</p>} />
        <Route path="/sub/playlists/:name/add" element={<PlaylistAddPage />} />
      </Routes>
    </MemoryRouter>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getAllTracks.mockResolvedValue([track(1, 'あ'), track(2, 'い'), track(3, 'う')])
  mocks.searchTracks.mockResolvedValue([track(3, 'う')])
  mocks.getPlaylists.mockResolvedValue([
    { id: 7, name: '作業用', trackIds: [1] },
    { id: 8, name: '100%', trackIds: [] },
  ])
  mocks.addTrackToPlaylist.mockResolvedValue(undefined)
  mocks.removeTrackFromPlaylist.mockResolvedValue(undefined)
})

afterEach(cleanup)

describe('PlaylistAddPage', () => {
  it('追加先を表示し、すでに入っている曲は追加済みにする', async () => {
    renderPage()
    await screen.findByTestId('row-2')
    expect(screen.getByText('playlist.add.target: 作業用')).toBeTruthy()
    expect(isAdded(1)).toBe(true)
    expect(isAdded(2)).toBe(false)
  })

  it('記号を含む名前のプレイリストも開ける', async () => {
    renderPage('100%')
    await screen.findByTestId('row-2')
    expect(screen.getByText('playlist.add.target: 100%')).toBeTruthy()
    expect(isAdded(1)).toBe(false)
  })

  it('+ を押すと即追加し、再生はしない', async () => {
    renderPage()
    await screen.findByTestId('row-2')
    fireEvent.click(button(2))
    await waitFor(() => expect(mocks.addTrackToPlaylist).toHaveBeenCalledWith(7, 2))
    expect(isAdded(2)).toBe(true)
    expect(mocks.playFromList).not.toHaveBeenCalled()
  })

  it('もう一度押すと取り消す', async () => {
    renderPage()
    await screen.findByTestId('row-1')
    fireEvent.click(button(1))
    await waitFor(() => expect(mocks.removeTrackFromPlaylist).toHaveBeenCalledWith(7, 1))
    expect(isAdded(1)).toBe(false)
  })

  it('連続で押しても書き込みは 1 件ずつ実行する', async () => {
    let finishFirst!: () => void
    mocks.addTrackToPlaylist.mockReturnValueOnce(new Promise<void>(r => { finishFirst = r }))
    renderPage()
    await screen.findByTestId('row-2')

    fireEvent.click(button(2))
    fireEvent.click(button(3))
    await waitFor(() => expect(mocks.addTrackToPlaylist).toHaveBeenCalledTimes(1))
    // 1 件目が終わるまで 2 件目は始まらない
    await new Promise(r => setTimeout(r))
    expect(mocks.addTrackToPlaylist).toHaveBeenCalledTimes(1)

    finishFirst()
    await waitFor(() => expect(mocks.addTrackToPlaylist).toHaveBeenCalledTimes(2))
    expect(mocks.addTrackToPlaylist).toHaveBeenLastCalledWith(7, 3)
  })

  it('書き込みに失敗したら表示を戻し、後続の書き込みは続ける', async () => {
    mocks.addTrackToPlaylist.mockRejectedValueOnce(new Error('locked'))
    renderPage()
    await screen.findByTestId('row-2')

    fireEvent.click(button(2))
    await waitFor(() => expect(mocks.showMessage).toHaveBeenCalled())
    expect(isAdded(2)).toBe(false)

    fireEvent.click(button(3))
    await waitFor(() => expect(mocks.addTrackToPlaylist).toHaveBeenLastCalledWith(7, 3))
    await waitFor(() => expect(isAdded(3)).toBe(true))
  })

  it('絞り込みで行が消えても、追加済みの表示を保つ', async () => {
    renderPage()
    await screen.findByTestId('row-2')
    fireEvent.click(button(2))
    await waitFor(() => expect(mocks.addTrackToPlaylist).toHaveBeenCalledWith(7, 2))

    fireEvent.change(input(), { target: { value: 'う' } })
    await waitFor(() => expect(screen.queryByTestId('row-2')).toBeNull())
    await screen.findByTestId('row-3')

    fireEvent.change(input(), { target: { value: '' } })
    await screen.findByTestId('row-2')
    expect(isAdded(2)).toBe(true)
  })

  it('行を押すと表示中のリストから再生する', async () => {
    renderPage()
    await screen.findByTestId('row-2')
    fireEvent.click(screen.getByTestId('row-2'))
    expect(mocks.playFromList).toHaveBeenCalledWith([1, 2, 3], 2)
  })

  it('入力欄に自動でフォーカスしない', async () => {
    renderPage()
    await screen.findByTestId('row-2')
    expect(document.activeElement).not.toBe(input())
  })

  it('完了で前のページに戻る', async () => {
    renderPage()
    fireEvent.click(screen.getByText('playlist.add.done'))
    await screen.findByText('details')
  })

  // 絞り込みを挟んで行を作り直す
  const remountRow = async (id: number) => {
    fireEvent.change(input(), { target: { value: 'う' } })
    await waitFor(() => expect(screen.queryByTestId(`row-${id}`)).toBeNull())
    await screen.findByTestId('row-3')
    fireEvent.change(input(), { target: { value: '' } })
    await screen.findByTestId(`row-${id}`)
  }

  it('書き込み中に行が作り直されても、追加済みの表示を保つ', async () => {
    let finish!: () => void
    mocks.addTrackToPlaylist.mockReturnValueOnce(new Promise<void>(r => { finish = r }))
    renderPage()
    await screen.findByTestId('row-2')

    fireEvent.click(button(2))
    await remountRow(2)
    expect(isAdded(2)).toBe(true)
    finish()
  })

  it('取り消した曲は、行が作り直されても未追加のまま', async () => {
    renderPage()
    await screen.findByTestId('row-1')
    fireEvent.click(button(1))
    await waitFor(() => expect(mocks.removeTrackFromPlaylist).toHaveBeenCalled())
    await remountRow(1)
    expect(isAdded(1)).toBe(false)
  })

  it('失敗した追加は、行が作り直されても未追加のまま', async () => {
    mocks.addTrackToPlaylist.mockRejectedValueOnce(new Error('locked'))
    renderPage()
    await screen.findByTestId('row-2')
    fireEvent.click(button(2))
    await waitFor(() => expect(mocks.showMessage).toHaveBeenCalled())
    await remountRow(2)
    expect(isAdded(2)).toBe(false)
  })

  it('スラッシュや空白を含む名前のプレイリストも開ける', async () => {
    mocks.getPlaylists.mockResolvedValue([{ id: 9, name: '朝 の/通勤', trackIds: [2] }])
    renderPage('朝 の/通勤')
    await screen.findByTestId('row-2')
    expect(isAdded(2)).toBe(true)
  })

  it('Enter のタグで絞り込める', async () => {
    renderPage()
    await screen.findByTestId('row-2')
    fireEvent.change(input(), { target: { value: '夜' } })
    fireEvent.keyDown(input(), { key: 'Enter' })
    await waitFor(() => expect(mocks.searchTracks).toHaveBeenLastCalledWith('', ['夜']))
  })

  it('結果が 0 件なら noItem を出す', async () => {
    mocks.searchTracks.mockResolvedValue([])
    renderPage()
    await screen.findByTestId('row-2')
    fireEvent.change(input(), { target: { value: 'x' } })
    await screen.findByText('search.noItem')
  })

  it('ミニプレイヤーの表示中は一覧の下に余白を取る', async () => {
    usePlayerStore.setState({ currentTrack: track(1, 'あ') })
    renderPage()
    await screen.findByTestId('row-2')
    const list = document.querySelector<HTMLElement>('.search-page-music-item-container')!
    expect(list.style.paddingBottom).toContain('calc')
    usePlayerStore.setState({ currentTrack: null })
  })
})
