// @vitest-environment jsdom
import { matchRoutes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import PlaylistAddPage from './pages/sub/PlaylistAddPage'
import PlaylistsDetailsPage from './pages/PlaylistsDetailsPage'
import SearchPage from './pages/sub/SearchPage'
import { router } from './router'

vi.mock('./lib/music', () => ({ musicPlayer: {} }))

const pageAt = (path: string) => {
  const matches = matchRoutes(router.routes, path) ?? []
  return (matches[matches.length - 1]?.route.element as { type?: unknown } | undefined)?.type
}

describe('router', () => {
  it('詳細の + が開く URL を追加ページに割り当てる', () => {
    const name = encodeURIComponent('朝 の/通勤')
    expect(pageAt(`/sub/playlists/${name}/add`)).toBe(PlaylistAddPage)
  })

  it('既存のページのルートを変えない', () => {
    expect(pageAt('/sub/search')).toBe(SearchPage)
    expect(pageAt('/playlists/foo')).toBe(PlaylistsDetailsPage)
  })
})
