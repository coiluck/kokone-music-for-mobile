const COMMANDS: &[&str] = &[
    "has_audio_permission",
    "request_audio_permission",
    "query_audio_metadata",
    "audio_hash",
    // addPluginListener が "plugin:android-media|register_listener" を呼ぶので
    // ACL で許可しておく必要がある。実体は Kotlin 側の Plugin 基底クラスにある。
    "register_listener",
    "remove_listener",
    // 注: 再生制御 (playback_*) は app 側 (src-tauri/src/music_playback.rs) の
    //     コマンド経由で Rust→Kotlin で呼ぶため、JS から直接 invoke することはなく、
    //     ACL を切る必要がない。
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .build();
}
