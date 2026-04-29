use serde::de::DeserializeOwned;
use tauri::{
    plugin::{PluginApi, PluginHandle},
    AppHandle, Runtime,
};

use crate::error::Result;
use crate::models::*;

const PLUGIN_IDENTIFIER: &str = "moe.coiluck.kokone_music.androidmedia";

pub fn init<R: Runtime, C: DeserializeOwned>(
    _app: &AppHandle<R>,
    api: PluginApi<R, C>,
) -> crate::Result<AndroidMedia<R>> {
    let handle = api.register_android_plugin(PLUGIN_IDENTIFIER, "AndroidMediaPlugin")?;
    Ok(AndroidMedia(handle))
}

pub struct AndroidMedia<R: Runtime>(PluginHandle<R>);

impl<R: Runtime> AndroidMedia<R> {
    pub fn has_audio_permission(&self) -> Result<PermissionResponse> {
        self.0
            .run_mobile_plugin::<PermissionResponse>("hasAudioPermission", ())
            .map_err(Into::into)
    }

    pub fn request_audio_permission(&self) -> Result<PermissionResponse> {
        self.0
            .run_mobile_plugin::<PermissionResponse>("requestAudioPermission", ())
            .map_err(Into::into)
    }

    pub fn query_audio_metadata(&self) -> Result<QueryAudioMetadataResponse> {
        self.0
            .run_mobile_plugin::<QueryAudioMetadataResponse>("queryAudioMetadata", ())
            .map_err(Into::into)
    }

    pub fn audio_hash(&self, payload: AudioHashRequest) -> Result<HashResponse> {
        self.0
            .run_mobile_plugin::<HashResponse>("audioHash", payload)
            .map_err(Into::into)
    }
}
