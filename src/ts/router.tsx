import { createBrowserRouter } from 'react-router-dom'
import App from './App'
import LibraryPage from './pages/LibraryPage'
import PlaylistsPage from './pages/PlaylistsPage'
import PlaylistsDetailsPage from './pages/PlaylistsDetailsPage'
import ArtistlistsPage from './pages/ArtistlistsPage'
import ArtistPage from './pages/ArtistPage'
import QueuePage from './pages/sub/QueuePage'
import SearchPage from './pages/sub/SearchPage'
import PlaylistIconEditPage from './pages/sub/IconEditPage'
import SettingsLayout from './SettingsLayout'

export const router = createBrowserRouter([
  {
    path: '/',
    element: <App />,          // サイドバー＋ミニプレイヤーの共通レイアウト
    children: [
      { index: true,           element: <LibraryPage /> },
      { path: 'playlists/',     element: <PlaylistsPage /> },
      { path: 'playlists/:name', element: <PlaylistsDetailsPage /> },
      { path: 'artist/',       element: <ArtistlistsPage /> },
      { path: 'artist/:name',  element: <ArtistPage /> },
      // subのページ
      { path: 'queue',         element: <QueuePage /> },
      { path: 'search',        element: <SearchPage /> },
      { path: 'playlist-icon-edit/:name', element: <PlaylistIconEditPage /> },
    ]
  },
  {
    path: '/settings',
    element: <SettingsLayout />, // MiniPlayerを隠すラッパー
  },
])