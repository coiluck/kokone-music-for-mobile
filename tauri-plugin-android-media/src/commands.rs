use tauri::{AppHandle, Runtime};

use crate::error::Result;
use crate::models::*;
use crate::AndroidMediaExt;

#[tauri::command]
pub(crate) async fn has_audio_permission<R: Runtime>(
    app: AppHandle<R>,
) -> Result<PermissionResponse> {
    app.android_media().has_audio_permission()
}

#[tauri::command]
pub(crate) async fn request_audio_permission<R: Runtime>(
    app: AppHandle<R>,
) -> Result<PermissionResponse> {
    app.android_media().request_audio_permission()
}

#[tauri::command]
pub(crate) async fn query_audio_metadata<R: Runtime>(
    app: AppHandle<R>,
) -> Result<QueryAudioMetadataResponse> {
    app.android_media().query_audio_metadata()
}

#[tauri::command]
pub(crate) async fn audio_hash<R: Runtime>(
    app: AppHandle<R>,
    payload: AudioHashRequest,
) -> Result<HashResponse> {
    app.android_media().audio_hash(payload)
}

#[tauri::command]
pub(crate) async fn playback_set_queue<R: Runtime>(
    app: AppHandle<R>,
    payload: PlaybackSetQueueRequest,
) -> Result<EmptyResponse> {
    app.android_media().playback_set_queue(payload)
}

#[tauri::command]
pub(crate) async fn playback_enqueue<R: Runtime>(
    app: AppHandle<R>,
    payload: PlaybackEnqueueRequest,
) -> Result<EmptyResponse> {
    app.android_media().playback_enqueue(payload)
}

#[tauri::command]
pub(crate) async fn playback_remove_at<R: Runtime>(
    app: AppHandle<R>,
    payload: PlaybackIndexRequest,
) -> Result<EmptyResponse> {
    app.android_media().playback_remove_at(payload)
}

#[tauri::command]
pub(crate) async fn playback_move<R: Runtime>(
    app: AppHandle<R>,
    payload: PlaybackMoveRequest,
) -> Result<EmptyResponse> {
    app.android_media().playback_move(payload)
}

#[tauri::command]
pub(crate) async fn playback_clear<R: Runtime>(app: AppHandle<R>) -> Result<EmptyResponse> {
    app.android_media().playback_clear()
}

#[tauri::command]
pub(crate) async fn playback_next<R: Runtime>(app: AppHandle<R>) -> Result<EmptyResponse> {
    app.android_media().playback_next()
}

#[tauri::command]
pub(crate) async fn playback_prev<R: Runtime>(app: AppHandle<R>) -> Result<EmptyResponse> {
    app.android_media().playback_prev()
}

#[tauri::command]
pub(crate) async fn playback_toggle_pause<R: Runtime>(
    app: AppHandle<R>,
) -> Result<EmptyResponse> {
    app.android_media().playback_toggle_pause()
}

#[tauri::command]
pub(crate) async fn playback_seek<R: Runtime>(
    app: AppHandle<R>,
    payload: PlaybackSeekRequest,
) -> Result<EmptyResponse> {
    app.android_media().playback_seek(payload)
}

#[tauri::command]
pub(crate) async fn playback_set_volume<R: Runtime>(
    app: AppHandle<R>,
    payload: PlaybackVolumeRequest,
) -> Result<EmptyResponse> {
    app.android_media().playback_set_volume(payload)
}

#[tauri::command]
pub(crate) async fn playback_snapshot<R: Runtime>(
    app: AppHandle<R>,
) -> Result<PlaybackSnapshot> {
    app.android_media().playback_snapshot()
}