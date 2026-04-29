'use strict';

Object.defineProperty(exports, '__esModule', { value: true });

var core = require('@tauri-apps/api/core');

async function hasAudioPermission() {
    const res = await core.invoke('plugin:android-media|has_audio_permission');
    return res.granted;
}

async function requestAudioPermission() {
    const res = await core.invoke('plugin:android-media|request_audio_permission');
    return res.granted;
}

async function queryAudioMetadata() {
    const res = await core.invoke('plugin:android-media|query_audio_metadata');
    return res.items;
}

async function audioHash(audioId, isMp3) {
    const res = await core.invoke('plugin:android-media|audio_hash', {
        payload: { audioId, isMp3 },
    });
    return res.hash;
}

exports.hasAudioPermission = hasAudioPermission;
exports.requestAudioPermission = requestAudioPermission;
exports.queryAudioMetadata = queryAudioMetadata;
exports.audioHash = audioHash;
