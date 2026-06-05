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

    /// ID3 タグの実ファイル書き込みに必要な権限を要求する。
    /// 既に許可済みなら granted=true。未許可なら (Android 11+ では) 全ファイルアクセスの
    /// 設定画面を開いて granted=false を返すので、ユーザーが許可後に再試行する。
    pub fn request_manage_storage_permission(&self) -> Result<PermissionResponse> {
        self.0
            .run_mobile_plugin::<PermissionResponse>("requestManageStoragePermission", ())
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

    pub fn open_audio_fd(&self, payload: OpenAudioFdRequest) -> Result<OpenAudioFdResponse> {
        self.0
            .run_mobile_plugin::<OpenAudioFdResponse>("openAudioFd", payload)
            .map_err(Into::into)
    }

    pub fn rename_audio_file(
        &self,
        payload: RenameAudioFileRequest,
    ) -> Result<RenameAudioFileResponse> {
        self.0
            .run_mobile_plugin::<RenameAudioFileResponse>("renameAudioFile", payload)
            .map_err(Into::into)
    }

    pub fn audio_ids_for_paths(
        &self,
        payload: AudioIdsForPathsRequest,
    ) -> Result<AudioIdsForPathsResponse> {
        self.0
            .run_mobile_plugin::<AudioIdsForPathsResponse>("audioIdsForPaths", payload)
            .map_err(Into::into)
    }

    pub fn playback_set_queue(&self, payload: PlaybackSetQueueRequest) -> Result<EmptyResponse> {
        self.0
            .run_mobile_plugin::<EmptyResponse>("playbackSetQueue", payload)
            .map_err(Into::into)
    }

    pub fn playback_enqueue(&self, payload: PlaybackEnqueueRequest) -> Result<EmptyResponse> {
        self.0
            .run_mobile_plugin::<EmptyResponse>("playbackEnqueue", payload)
            .map_err(Into::into)
    }

    pub fn playback_append_queue(
        &self,
        payload: PlaybackAppendQueueRequest,
    ) -> Result<EmptyResponse> {
        self.0
            .run_mobile_plugin::<EmptyResponse>("playbackAppendQueue", payload)
            .map_err(Into::into)
    }

    pub fn playback_remove_at(&self, payload: PlaybackIndexRequest) -> Result<EmptyResponse> {
        self.0
            .run_mobile_plugin::<EmptyResponse>("playbackRemoveAt", payload)
            .map_err(Into::into)
    }

    pub fn playback_move(&self, payload: PlaybackMoveRequest) -> Result<EmptyResponse> {
        self.0
            .run_mobile_plugin::<EmptyResponse>("playbackMove", payload)
            .map_err(Into::into)
    }

    pub fn playback_clear(&self) -> Result<EmptyResponse> {
        self.0
            .run_mobile_plugin::<EmptyResponse>("playbackClear", ())
            .map_err(Into::into)
    }

    pub fn playback_next(&self) -> Result<EmptyResponse> {
        self.0
            .run_mobile_plugin::<EmptyResponse>("playbackNext", ())
            .map_err(Into::into)
    }

    pub fn playback_prev(&self) -> Result<EmptyResponse> {
        self.0
            .run_mobile_plugin::<EmptyResponse>("playbackPrev", ())
            .map_err(Into::into)
    }

    pub fn playback_toggle_pause(&self) -> Result<EmptyResponse> {
        self.0
            .run_mobile_plugin::<EmptyResponse>("playbackTogglePause", ())
            .map_err(Into::into)
    }

    pub fn playback_seek(&self, payload: PlaybackSeekRequest) -> Result<EmptyResponse> {
        self.0
            .run_mobile_plugin::<EmptyResponse>("playbackSeek", payload)
            .map_err(Into::into)
    }

    pub fn playback_set_volume(&self, payload: PlaybackVolumeRequest) -> Result<EmptyResponse> {
        self.0
            .run_mobile_plugin::<EmptyResponse>("playbackSetVolume", payload)
            .map_err(Into::into)
    }

    pub fn playback_snapshot(&self) -> Result<PlaybackSnapshot> {
        self.0
            .run_mobile_plugin::<PlaybackSnapshot>("playbackSnapshot", ())
            .map_err(Into::into)
    }
}
