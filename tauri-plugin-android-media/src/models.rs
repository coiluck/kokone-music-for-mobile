use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioMeta {
    pub id: i64,
    pub display_path: String,
    pub display_name: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub duration_ms: i64,
    pub size_bytes: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioHashRequest {
    pub audio_id: i64,
    pub is_mp3: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionResponse {
    pub granted: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HashResponse {
    pub hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenAudioFdRequest {
    pub audio_id: i64,
    /// true なら "rw" で開く (ID3 書き込み用)。false なら従来どおり "r" (読み取り)。
    pub writable: bool,
}

/// Kotlin が `detachFd()` で切り離した生 fd。所有権は呼び出し側へ移る。
/// 取得失敗時は -1。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenAudioFdResponse {
    pub fd: i32,
}

/// MediaStore 上のファイル名 (DISPLAY_NAME) を変更する。
/// `display_name` は拡張子込みの希望ファイル名 (例 "新しいタイトル.mp3")。
/// 同名衝突は Kotlin 側で末尾連番を付けて回避する。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameAudioFileRequest {
    pub audio_id: i64,
    pub display_name: String,
}

/// リネーム後の実パス (MediaStore の DATA 列)。失敗時は空文字。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameAudioFileResponse {
    pub new_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryAudioMetadataResponse {
    pub items: Vec<AudioMeta>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackQueueItem {
    pub track_id: i64,
    /// MediaStore.Audio.Media._ID — Kotlin 側で content URI に組み立てる。
    pub audio_id: i64,
    pub title: String,
    pub artist: String,
    pub gain: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackSetQueueRequest {
    pub items: Vec<PlaybackQueueItem>,
    pub start_index: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackEnqueueRequest {
    pub item: PlaybackQueueItem,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackAppendQueueRequest {
    pub items: Vec<PlaybackQueueItem>,
}

/// 「path のリスト → MediaStore audio_id への解決」を Kotlin に依頼する。
/// 全件スキャンを避けるため WHERE IN (...) で targeted lookup する。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioIdsForPathsRequest {
    pub paths: Vec<String>,
}

/// `ids` には見つかった path だけが含まれる。
/// 該当ファイルが MediaStore から消えていれば map に乗らないので、
/// 呼び出し側は Option で受ける。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioIdsForPathsResponse {
    pub ids: HashMap<String, i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackIndexRequest {
    pub index: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackMoveRequest {
    pub from: i32,
    pub to: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackSeekRequest {
    pub position_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackVolumeRequest {
    pub volume: f32,
    pub normalize: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmptyResponse {}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackSnapshot {
    pub current_index: i32,
    pub is_playing: bool,
    pub position_ms: i64,
    pub duration_ms: i64,
    pub current_track_id: Option<i64>,
}