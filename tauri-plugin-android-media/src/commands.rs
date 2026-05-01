use tauri::{AppHandle, Runtime};

use crate::error::Result;
use crate::models::*;
use crate::AndroidMediaExt;

#[tauri::command]
pub(crate) async fn has_audio_permission<R: Runtime>(app: AppHandle<R>) -> Result<PermissionResponse> {
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
pub(crate) async fn prepare_audio<R: Runtime>(
    app: AppHandle<R>,
    payload: PrepareAudioRequest,
) -> Result<PrepareAudioResponse> {
    app.android_media().prepare_audio(payload)
}