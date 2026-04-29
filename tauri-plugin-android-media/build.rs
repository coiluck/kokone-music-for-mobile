const COMMANDS: &[&str] = &[
    "has_audio_permission",
    "request_audio_permission",
    "query_audio_metadata",
    "audio_hash",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .build();
}
