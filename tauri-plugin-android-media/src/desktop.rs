use serde::de::DeserializeOwned;
use tauri::{plugin::PluginApi, AppHandle, Runtime};

use crate::error::Result;
use crate::models::*;

pub fn init<R: Runtime, C: DeserializeOwned>(
    app: &AppHandle<R>,
    _api: PluginApi<R, C>,
) -> crate::Result<AndroidMedia<R>> {
    Ok(AndroidMedia(app.clone()))
}

pub struct AndroidMedia<R: Runtime>(AppHandle<R>);

impl<R: Runtime> AndroidMedia<R> {
    pub fn has_audio_permission(&self) -> Result<PermissionResponse> {
        Ok(PermissionResponse { granted: true })
    }

    pub fn request_audio_permission(&self) -> Result<PermissionResponse> {
        Ok(PermissionResponse { granted: true })
    }

    pub fn query_audio_metadata(&self) -> Result<QueryAudioMetadataResponse> {
        Ok(QueryAudioMetadataResponse { items: Vec::new() })
    }

    pub fn audio_hash(&self, _payload: AudioHashRequest) -> Result<HashResponse> {
        Ok(HashResponse {
            hash: String::new(),
        })
    }

    pub fn playback_set_queue(&self, _payload: PlaybackSetQueueRequest) -> Result<EmptyResponse> {
        Ok(EmptyResponse::default())
    }

    pub fn playback_enqueue(&self, _payload: PlaybackEnqueueRequest) -> Result<EmptyResponse> {
        Ok(EmptyResponse::default())
    }

    pub fn playback_remove_at(&self, _payload: PlaybackIndexRequest) -> Result<EmptyResponse> {
        Ok(EmptyResponse::default())
    }

    pub fn playback_move(&self, _payload: PlaybackMoveRequest) -> Result<EmptyResponse> {
        Ok(EmptyResponse::default())
    }

    pub fn playback_clear(&self) -> Result<EmptyResponse> {
        Ok(EmptyResponse::default())
    }

    pub fn playback_next(&self) -> Result<EmptyResponse> {
        Ok(EmptyResponse::default())
    }

    pub fn playback_prev(&self) -> Result<EmptyResponse> {
        Ok(EmptyResponse::default())
    }

    pub fn playback_toggle_pause(&self) -> Result<EmptyResponse> {
        Ok(EmptyResponse::default())
    }

    pub fn playback_seek(&self, _payload: PlaybackSeekRequest) -> Result<EmptyResponse> {
        Ok(EmptyResponse::default())
    }

    pub fn playback_set_volume(&self, _payload: PlaybackVolumeRequest) -> Result<EmptyResponse> {
        Ok(EmptyResponse::default())
    }

    pub fn playback_snapshot(&self) -> Result<PlaybackSnapshot> {
        Ok(PlaybackSnapshot {
            current_index: -1,
            is_playing: false,
            position_ms: 0,
            duration_ms: 0,
            current_track_id: None,
        })
    }
}