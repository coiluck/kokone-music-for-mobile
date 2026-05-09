use serde::{Deserialize, Serialize};

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