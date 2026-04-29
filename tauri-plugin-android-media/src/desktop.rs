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
}
