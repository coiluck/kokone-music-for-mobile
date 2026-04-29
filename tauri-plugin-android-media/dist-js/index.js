import { invoke } from '@tauri-apps/api/core';

export async function hasAudioPermission() {
    const res = await invoke('plugin:android-media|has_audio_permission');
    return res.granted;
}

/**
 * Prompts the user for audio read permission. The returned promise resolves
 * after the user has accepted or denied the request — no polling needed.
 */
export async function requestAudioPermission() {
    const res = await invoke('plugin:android-media|request_audio_permission');
    return res.granted;
}

export async function queryAudioMetadata() {
    const res = await invoke('plugin:android-media|query_audio_metadata');
    return res.items;
}

export async function audioHash(audioId, isMp3) {
    const res = await invoke('plugin:android-media|audio_hash', {
        payload: { audioId, isMp3 },
    });
    return res.hash;
}
