//! アプリ全体のエラー型。コマンドの戻り値としてフロントにはメッセージの文字列で渡る。

use std::fmt::Display;

pub type Result<T, E = Error> = std::result::Result<T, E>;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Db(#[from] rusqlite::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    #[error(transparent)]
    Tauri(#[from] tauri::Error),
    #[error(transparent)]
    AndroidMedia(#[from] tauri_plugin_android_media::Error),
    #[error(transparent)]
    Tag(#[from] lofty::error::LoftyError),
    #[error(transparent)]
    Decode(#[from] symphonia::core::errors::Error),
    #[error(transparent)]
    Loudness(#[from] ebur128::Error),
    #[error(transparent)]
    Model(#[from] tract_onnx::prelude::TractError),
    #[error(transparent)]
    Http(#[from] reqwest::Error),
    /// 全ファイルアクセスが未許可 (Android)。フロント (MusicItem.tsx) がこの文字列で判定する。
    #[error("NEED_STORAGE_PERMISSION")]
    NeedStoragePermission,
    #[error("{0}")]
    Other(String),
}

impl Error {
    pub fn msg(e: impl Display) -> Self {
        Self::Other(e.to_string())
    }
}

impl From<&str> for Error {
    fn from(s: &str) -> Self {
        Self::Other(s.into())
    }
}

impl From<String> for Error {
    fn from(s: String) -> Self {
        Self::Other(s)
    }
}

impl serde::Serialize for Error {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

/// `f` の panic を Err に変える。1 曲の解析の失敗でバックグラウンド処理全体が止まらないようにする。
pub fn catch_panic<T>(f: impl FnOnce() -> Result<T>) -> Result<T> {
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(f)).unwrap_or_else(|_| Err("panicked".into()))
}
