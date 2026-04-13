import { createBrowserRouter } from 'react-router-dom'
import App from './App'
import LibraryPage from './pages/LibraryPage'
import PlaylistsPage from './pages/PlaylistsPage'
import ArtistlistsPage from './pages/ArtistlistsPage'
import ArtistPage from './pages/ArtistPage'
import SettingsLayout from './SettingsLayout'

export const router = createBrowserRouter([
  {
    path: '/',
    element: <App />,          // サイドバー＋ミニプレイヤーの共通レイアウト
    children: [
      { index: true,            element: <LibraryPage /> },
      { path: 'playlists',      element: <PlaylistsPage /> },
      { path: 'artist/',   element: <ArtistlistsPage /> },
      { path: 'artist/:name',   element: <ArtistPage /> }
    ]
  },
  {
    path: '/settings',
    element: <SettingsLayout />,  // MiniPlayerを隠すラッパー
  }
])