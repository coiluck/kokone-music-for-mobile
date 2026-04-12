import { createBrowserRouter } from 'react-router-dom'
import App from './App'
import LibraryPage from './pages/LibraryPage'
import PlaylistsPage from './pages/PlaylistsPage'
import ArtistPage from './pages/ArtistPage'
import SettingsPage from './pages/SettingsPage'

export const router = createBrowserRouter([
  {
    path: '/',
    element: <App />,          // サイドバー＋ミニプレイヤーの共通レイアウト
    children: [
      { index: true,            element: <LibraryPage /> },
      { path: 'playlists',      element: <PlaylistsPage /> },
      { path: 'artist/:name',   element: <ArtistPage /> },
      { path: 'settings',       element: <SettingsPage /> },
    ]
  }
])