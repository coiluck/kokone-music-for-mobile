// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Track } from '../../lib/db'
import { usePlayerStore } from '../../lib/playerStore'
import { useScanStore } from '../../lib/scanStore'
import SearchPage from './SearchPage'

const mocks = vi.hoisted(() => ({
  getAllTracks: vi.fn(),
  searchTracks: vi.fn(),
  playFromList: vi.fn(),
}))

vi.mock('../../lib/db', () => ({
  getAllTracks: mocks.getAllTracks,
  searchTracks: mocks.searchTracks,
}))
vi.mock('../../lib/trackActions', () => ({ playFromList: mocks.playFromList }))
vi.mock('../../lib/i18n', () => ({
  // 翻訳キーをそのまま文言として返す
  useMappedTranslations: (mapping: Record<string, string>) => mapping,
}))
vi.mock('../../components/MusicItem', () => ({
  default: ({ trackId, onPlay }: { trackId: number; onPlay: (id: number) => void }) => (
    <button data-testid="track" onClick={() => onPlay(trackId)}>{trackId}</button>
  ),
}))

const track = (id: number, title: string) => ({ id, title }) as Track

const trackIds = () => screen.queryAllByTestId('track').map(el => Number(el.textContent))
const input = () => screen.getByPlaceholderText('search.input.placeholder') as HTMLInputElement
const type = (value: string) => fireEvent.change(input(), { target: { value } })
const tagTexts = () =>
  [...document.querySelectorAll('.search-page-input-tags-item')].map(el => el.textContent)

// 同じページのまま遷移を発生させるためのボタン
function Navigator() {
  const navigate = useNavigate()
  return (
    <>
      <button onClick={() => navigate('/sub/search', { replace: true, state: { initialTags: ['b', 'a'] } })}>
        reopen-with-tags
      </button>
      <button onClick={() => navigate('/sub/search', { replace: true })}>reopen</button>
    </>
  )
}

function renderPage(state?: { initialTags: string[] }) {
  return render(
    <MemoryRouter initialEntries={['/', { pathname: '/sub/search', state }]} initialIndex={1}>
      <Routes>
        <Route path="/" element={<p>home</p>} />
        <Route path="/sub/search" element={<><SearchPage /><Navigator /></>} />
      </Routes>
    </MemoryRouter>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getAllTracks.mockResolvedValue([track(1, 'い'), track(2, 'あ')])
  mocks.searchTracks.mockResolvedValue([track(3, 'う')])
  usePlayerStore.setState({ currentTrack: null })
})

afterEach(cleanup)

describe('検索の実行', () => {
  it('条件がなければ全曲をタイトル順に出す', async () => {
    renderPage()
    await waitFor(() => expect(trackIds()).toEqual([2, 1]))
    expect(mocks.getAllTracks).toHaveBeenCalled()
    expect(mocks.searchTracks).not.toHaveBeenCalled()
    expect(screen.getByText('2 search.count')).toBeTruthy()
  })

  it('入力すると検索して結果を出す', async () => {
    renderPage()
    await waitFor(() => expect(trackIds()).toEqual([2, 1]))
    type('foo')
    await waitFor(() => expect(trackIds()).toEqual([3]))
    expect(mocks.searchTracks).toHaveBeenLastCalledWith('foo', [])
  })

  it('空白だけの入力は全曲を出す', async () => {
    renderPage()
    await waitFor(() => expect(trackIds()).toEqual([2, 1]))
    type('   ')
    await waitFor(() => expect(mocks.getAllTracks).toHaveBeenCalledTimes(2))
    expect(mocks.searchTracks).not.toHaveBeenCalled()
  })

  it('スキャンが完了すると読み直す', async () => {
    renderPage()
    await waitFor(() => expect(mocks.getAllTracks).toHaveBeenCalledTimes(1))
    act(() => useScanStore.getState().notifyScanCompleted())
    await waitFor(() => expect(mocks.getAllTracks).toHaveBeenCalledTimes(2))
  })
})

describe('タグの操作', () => {
  it('Enter で入力をタグにして、入力欄を空にする', async () => {
    renderPage()
    type('foo')
    fireEvent.keyDown(input(), { key: 'Enter' })
    await waitFor(() => expect(tagTexts()).toEqual(['foo']))
    expect(input().value).toBe('')
    await waitFor(() => expect(mocks.searchTracks).toHaveBeenLastCalledWith('', ['foo']))
  })

  it('同じタグは増やさず、入力欄だけ空にする', async () => {
    renderPage({ initialTags: ['foo'] })
    await waitFor(() => expect(tagTexts()).toEqual(['foo']))
    type('foo')
    fireEvent.keyDown(input(), { key: 'Enter' })
    await waitFor(() => expect(input().value).toBe(''))
    expect(tagTexts()).toEqual(['foo'])
  })

  it('空白だけの Enter ではタグを作らない', async () => {
    renderPage()
    type('  ')
    fireEvent.keyDown(input(), { key: 'Enter' })
    await waitFor(() => expect(mocks.getAllTracks).toHaveBeenCalled())
    expect(tagTexts()).toEqual([])
    expect(input().value).toBe('  ')
  })

  it('IME 変換中の Enter ではタグを作らない', async () => {
    renderPage()
    type('foo')
    fireEvent.keyDown(input(), { key: 'Enter', isComposing: true })
    await waitFor(() => expect(mocks.searchTracks).toHaveBeenCalled())
    expect(tagTexts()).toEqual([])
    expect(input().value).toBe('foo')
  })

  it('Enter 以外のキーではタグを作らない', async () => {
    renderPage()
    type('foo')
    fireEvent.keyDown(input(), { key: 'a' })
    await waitFor(() => expect(mocks.searchTracks).toHaveBeenCalled())
    expect(tagTexts()).toEqual([])
  })

  it('タグを押すと外す', async () => {
    renderPage({ initialTags: ['a', 'b'] })
    await waitFor(() => expect(tagTexts()).toEqual(['a', 'b']))
    fireEvent.click(screen.getByText('a'))
    await waitFor(() => expect(tagTexts()).toEqual(['b']))
    await waitFor(() => expect(mocks.searchTracks).toHaveBeenLastCalledWith('', ['b']))
  })

  it('クリアボタンで入力とタグの両方を消す', async () => {
    renderPage({ initialTags: ['a'] })
    await waitFor(() => expect(tagTexts()).toEqual(['a']))
    type('foo')
    fireEvent.click(document.querySelector('.search-page-input-clear')!)
    await waitFor(() => expect(tagTexts()).toEqual([]))
    expect(input().value).toBe('')
  })
})

describe('遷移時の initialTags とフォーカス', () => {
  it('initialTags で検索し、入力欄にはフォーカスしない', async () => {
    renderPage({ initialTags: ['a'] })
    await waitFor(() => expect(mocks.searchTracks).toHaveBeenLastCalledWith('', ['a']))
    expect(document.activeElement).not.toBe(input())
  })

  it('initialTags がなければ入力欄にフォーカスする', async () => {
    renderPage()
    await waitFor(() => expect(document.activeElement).toBe(input()))
  })

  it('開き直すと initialTags を重複なくマージする', async () => {
    renderPage({ initialTags: ['a'] })
    await waitFor(() => expect(tagTexts()).toEqual(['a']))
    fireEvent.click(screen.getByText('reopen-with-tags'))
    await waitFor(() => expect(tagTexts()).toEqual(['a', 'b']))
  })

  it('initialTags なしで開き直すと、入力欄にフォーカスを戻す', async () => {
    renderPage()
    await waitFor(() => expect(document.activeElement).toBe(input()))
    input().blur()
    fireEvent.click(screen.getByText('reopen'))
    await waitFor(() => expect(document.activeElement).toBe(input()))
  })
})

describe('開き直したときの入力欄', () => {
  it('入力済みの文字を全選択する', async () => {
    renderPage()
    type('foo')
    await waitFor(() => expect(mocks.searchTracks).toHaveBeenCalled())
    input().setSelectionRange(3, 3)
    fireEvent.click(screen.getByText('reopen'))
    await waitFor(() => expect(input().selectionStart).toBe(0))
    expect(input().selectionEnd).toBe(3)
  })
})

describe('一覧の操作', () => {
  it('行を押すと表示中のリストから再生する', async () => {
    renderPage()
    await waitFor(() => expect(trackIds()).toEqual([2, 1]))
    fireEvent.click(screen.getAllByTestId('track')[1])
    expect(mocks.playFromList).toHaveBeenCalledWith([2, 1], 1)
  })

  it('キャンセルで前のページに戻る', async () => {
    renderPage()
    fireEvent.click(screen.getByLabelText('back'))
    await screen.findByText('home')
  })
})

describe('表示状態', () => {
  it('読み込み中は読み込み文言を出す', async () => {
    let resolve!: (tracks: Track[]) => void
    mocks.getAllTracks.mockReturnValue(new Promise(r => { resolve = r }))
    renderPage()
    await screen.findByText('search.loading')
    await act(async () => resolve([track(1, 'い')]))
    await waitFor(() => expect(trackIds()).toEqual([1]))
    expect(screen.queryByText('search.loading')).toBeNull()
  })

  it('検索条件があって結果が 0 件なら noItem を出す', async () => {
    mocks.searchTracks.mockResolvedValue([])
    renderPage({ initialTags: ['a'] })
    await screen.findByText('search.noItem')
  })

  it('検索条件がなく曲も 0 件なら noWord を出す', async () => {
    mocks.getAllTracks.mockResolvedValue([])
    renderPage()
    await screen.findByText('search.noWord')
  })

  it('ミニプレイヤーの表示中は一覧の下に余白を取る', async () => {
    const container = async () => {
      await waitFor(() => expect(trackIds()).toEqual([2, 1]))
      return document.querySelector<HTMLElement>('.search-page-music-item-container')!
    }
    const { unmount } = renderPage()
    expect((await container()).style.paddingBottom).toBe('0px')
    unmount()

    usePlayerStore.setState({ currentTrack: track(1, 'い') })
    renderPage()
    expect((await container()).style.paddingBottom).toContain('calc')
  })
})
