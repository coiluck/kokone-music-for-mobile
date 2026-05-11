import { createBrowserRouter } from 'react-router-dom'
import App from './App'
import LibraryPage from './pages/LibraryPage'
import PlaylistsPage from './pages/PlaylistsPage'
import PlaylistsDetailsPage from './pages/PlaylistsDetailsPage'
import ArtistlistsPage from './pages/ArtistlistsPage'
import ArtistPage from './pages/ArtistPage'
import TagsPage from './pages/TagsPage'
import TagsDetailsPage from './pages/TagsDetailsPage'
import AlbumPage from './pages/AlbumPage'
import AlbumDetailsPage from './pages/AlbumDetailsPage'
import QueuePage from './pages/sub/QueuePage'
import SearchPage from './pages/sub/SearchPage'
import IconEditPage from './pages/sub/IconEditPage'
import SubLayout from './layouts/SubLayout'
import SettingsLayout from './layouts/SettingsLayout'

export const router = createBrowserRouter([
  {
    path: '/',
    element: <App />,          // サイドバー＋ミニプレイヤーの共通レイアウト
    children: [
      { index: true,           element: <LibraryPage /> },
      { path: 'tags/',         element: <TagsPage /> },
      { path: 'tags/:listName', element: <TagsDetailsPage /> },
      { path: 'playlists/',     element: <PlaylistsPage /> },
      { path: 'playlists/:name', element: <PlaylistsDetailsPage /> },
      { path: 'artist/',       element: <ArtistlistsPage /> },
      { path: 'artist/:name',  element: <ArtistPage /> },
      { path: 'album/',        element: <AlbumPage /> },
      { path: 'album/:name',   element: <AlbumDetailsPage /> },
      // subのページ
      { path: '/icon-edit/:kind/:name', element: <IconEditPage  /> },
    ]
  },
  {
    path: '/sub',
    element: <SubLayout />,
    children: [
      { path: 'queue', element: <QueuePage /> },
      { path: 'search', element: <SearchPage /> },
    ]
  },
  {
    path: '/settings',
    element: <SettingsLayout />,
  },
])