// フロントから使う DB 操作
// テーブルごとにファイルを分けている
export { initDb } from './connection'
export {
  type Track,
  getAllTracks, searchTracks, updateTrack, getAlbums, getAlbumTracks,
} from './tracks'
export {
  type ListeningClock, type ListeningDay,
  getHistory, startPlay, updateListenedMs,
  getListeningClock, getTotalListeningMs, getListeningHeatmap,
} from './history'
export { getRecommended } from './recommend'
export {
  type Playlist,
  getPlaylists, getPlaylistTracks, addPlaylist, deletePlaylist, renamePlaylist,
  addTrackToPlaylist, removeTrackFromPlaylist, setPlaylistIcon,
} from './playlists'
export {
  type Taglist,
  getTaglists, addTaglist, deleteTaglist, renameTaglist, setTaglistIcon,
  getTaglistTracks, setTaglistPositiveTags, setTaglistNegativeTags,
} from './taglists'
