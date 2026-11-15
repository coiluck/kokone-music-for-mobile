import { createBrowserRouter } from 'react-router-dom'
import RootLayout from './layouts/RootLayout'
import MainLayout from './layouts/MainLayout'
import LibraryPage from './pages/LibraryPage'
import PlaylistsPage from './pages/PlaylistsPage'
import PlaylistsDetailsPage from './pages/PlaylistsDetailsPage'
import ArtistsPage from './pages/ArtistsPage'
import ArtistsDetailsPage from './pages/ArtistsDetailsPage'
import TagsPage from './pages/TagsPage'
import TagsDetailsPage from './pages/TagsDetailsPage'
import AlbumPage from './pages/AlbumPage'
import AlbumDetailsPage from './pages/AlbumDetailsPage'
import QueuePage from './pages/sub/QueuePage'
import SearchPage from './pages/sub/SearchPage'
import PlaylistAddPage from './pages/sub/PlaylistAddPage'
import SubLayout from './layouts/SubLayout'
import SettingsPage from './pages/SettingsPage'
import StatsPage from './pages/sub/StatsPage'

export const router = createBrowserRouter([
  {
    element: <RootLayout />, // 全ページ共通 (Sidebar, Message)
    children: [
      {
        path: '/',
        element: <MainLayout />, // ミニプレイヤー + HeaderApp
        children: [
          { index: true,           element: <LibraryPage /> },
          { path: 'tags/',         element: <TagsPage /> },
          { path: 'tags/:listName', element: <TagsDetailsPage /> },
          { path: 'playlists/',     element: <PlaylistsPage /> },
          { path: 'playlists/:name', element: <PlaylistsDetailsPage /> },
          { path: 'artist/',       element: <ArtistsPage /> },
          { path: 'artist/:name',  element: <ArtistsDetailsPage /> },
          { path: 'album/',        element: <AlbumPage /> },
          { path: 'album/:name',   element: <AlbumDetailsPage /> },
        ]
      },
      {
        path: '/sub',
        element: <SubLayout />,  // ミニプレイヤー + HeaderSub
        children: [
          { path: 'queue', element: <QueuePage /> },
          { path: 'search', element: <SearchPage /> },
          { path: 'playlists/:name/add', element: <PlaylistAddPage /> },
        ]
      },
      // HeaderSub のみ。Sidebar はスマホでは CSS で隠す
      { path: '/settings', element: <SettingsPage /> },
      { path: '/stats', element: <StatsPage /> },
    ]
  },
])