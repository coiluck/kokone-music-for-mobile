// Android: MediaStore アクセスは tauri-plugin-android-media に移譲する。
// このファイルは scan-folder 一覧 (フロント向け) と、scan_music.rs から
// 使う薄いヘルパだけを残す。
//
// scoped storage 環境では Rust 側から /storage/emulated/0/... を直接 fopen
// できない場合があるため、ファイルの中身を読む処理 (タグ取得・ハッシュ計算) は
// すべて Kotlin 側 (ContentResolver.openFileDescriptor 経由) で行う。

#[cfg(target_os = "android")]
use tauri_plugin_android_media::{
    AndroidMediaExt, AudioHashRequest, AudioIdsForPathsRequest, OpenAudioFdRequest,
};
use tauri::{AppHandle, Runtime};

pub use tauri_plugin_android_media::AudioMeta as AndroidAudioMeta;

/// MediaStore に登録されている音楽ファイルのメタデータ一覧を返す。
/// scan_music.rs (Android 版) がここから候補を作る。
#[cfg(target_os = "android")]
pub fn query_audio_metadata<R: Runtime>(app: &AppHandle<R>) -> Result<Vec<AndroidAudioMeta>, String> {
    app.android_media()
        .query_audio_metadata()
        .map(|res| res.items)
        .map_err(|e| e.to_string())
}

#[cfg(not(target_os = "android"))]
pub fn query_audio_metadata<R: Runtime>(_app: &AppHandle<R>) -> Result<Vec<AndroidAudioMeta>, String> {
    Ok(Vec::new())
}

/// 指定された Audio ID のファイル内容のハッシュを返す。
/// Kotlin 側で ContentResolver 経由で読むので scoped storage でも安全。
/// scan_music.rs の Android 分岐からのみ呼ばれるため Android 限定。
#[cfg(target_os = "android")]
pub fn audio_hash<R: Runtime>(
    app: &AppHandle<R>,
    audio_id: i64,
    is_mp3: bool,
) -> Result<String, String> {
    app.android_media()
        .audio_hash(AudioHashRequest { audio_id, is_mp3 })
        .map(|res| res.hash)
        .map_err(|e| e.to_string())
}

/// 指定された Audio ID のファイルを開き、生の fd を返す。
/// Kotlin 側で `detachFd()` 済みなので、この fd を閉じる責任は呼び出し側にある
/// (audio_analysis::analyze_fd が File::from_raw_fd で受け取り drop 時に close する)。
/// 取得失敗時は Err。
#[cfg(target_os = "android")]
pub fn open_audio_fd<R: Runtime>(app: &AppHandle<R>, audio_id: i64) -> Result<i32, String> {
    let fd = app
        .android_media()
        .open_audio_fd(OpenAudioFdRequest { audio_id })
        .map(|res| res.fd)
        .map_err(|e| e.to_string())?;
    if fd < 0 {
        return Err(format!("openAudioFd returned invalid fd for id={audio_id}"));
    }
    Ok(fd)
}

/// path のリストを MediaStore audio_id に解決する (見つかった path だけ map に乗る)。
/// LUFS 解析時に DB の path から fd 取得用の audio_id を引くために使う。
#[cfg(target_os = "android")]
pub fn audio_ids_for_paths<R: Runtime>(
    app: &AppHandle<R>,
    paths: Vec<String>,
) -> Result<std::collections::HashMap<String, i64>, String> {
    if paths.is_empty() {
        return Ok(std::collections::HashMap::new());
    }
    app.android_media()
        .audio_ids_for_paths(AudioIdsForPathsRequest { paths })
        .map(|res| res.ids)
        .map_err(|e| e.to_string())
}

/// MediaStore に登録されている音楽ファイルが置かれている「フォルダ一覧」を返す。
/// フロントの「フォルダ選択モーダル」で表示するためのもの。
/// 各ファイルの親ディレクトリ集合を distinct でソートして返す。
#[tauri::command]
pub fn android_list_audio_folders(app: AppHandle) -> Result<Vec<String>, String> {
    use std::collections::BTreeSet;
    let metas = query_audio_metadata(&app)?;
    let mut folders: BTreeSet<String> = BTreeSet::new();
    for m in metas {
        if let Some(parent) = std::path::Path::new(&m.display_path).parent() {
            if let Some(s) = parent.to_str() {
                folders.insert(s.to_string());
            }
        }
    }
    Ok(folders.into_iter().collect())
}
