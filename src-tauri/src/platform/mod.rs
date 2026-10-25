//! デスクトップと Android で違う処理。どちらの実装も同じ名前・同じ型の関数を持つので、
//! 呼び出し側はプラットフォームで分岐しない。
//!
//! Android は scoped storage のため、Rust から音楽ファイルのパスを直接開けない
//! (開けても EACCES になる)。ファイルの一覧とメタデータは MediaStore から取り、
//! ファイルの中身は Kotlin (ContentResolver) で開いた fd から読む。
//!
//! - `Candidate` / `list_candidates`: スキャン対象フォルダ内の音楽ファイル
//! - `existence`: DB の曲のファイルがまだあるか
//! - `read_meta` / `hash`: 新しく追加する曲のタグとハッシュ
//! - `AudioFiles`: 解析のために曲を読み取りで開く
//! - `open_for_edit`: タグ編集のために曲を読み書きで開く
//! - `for_each`: 曲ごとの解析を回す (デスクトップは並列。Android は JNI を使うので逐次)

#[cfg(not(target_os = "android"))]
mod desktop;
#[cfg(not(target_os = "android"))]
pub use desktop::*;

#[cfg(target_os = "android")]
mod android;
#[cfg(target_os = "android")]
pub use android::*;

pub const SUPPORTED_EXTENSIONS: &[&str] = &["mp3", "flac", "ogg", "m4a", "aac", "wav"];

/// 曲のタグから読んだ情報。
pub struct TrackMeta {
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub duration_ms: i64,
}

/// 小文字の拡張子 (無ければ空文字)。
pub fn extension(path: &str) -> String {
    std::path::Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase()
}

fn is_supported(path: &str) -> bool {
    SUPPORTED_EXTENSIONS.contains(&extension(path).as_str())
}
