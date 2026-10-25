use crate::error::Result;
use crate::platform;
use lofty::config::WriteOptions;
use lofty::file::{FileType, TaggedFileExt};
use lofty::probe::Probe;
use lofty::tag::{Accessor, Tag, TagExt};
use std::fs::File;
use std::io::Seek;

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditTrackPayload {
    pub path: String,
    pub title: String,
    pub artist: String,
    pub album: Option<String>,
    /// タイトル変更に合わせてファイル名も変更するか (Android のみ)。
    /// フロントがタイトルが実際に変わったときだけ true にする。
    #[serde(default)]
    #[cfg_attr(not(target_os = "android"), allow(dead_code))]
    pub rename_to_title: bool,
}

#[derive(serde::Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct EditTrackResponse {
    /// リネームが成功したときの新しいパス。リネームしなかった場合は None。
    pub new_path: Option<String>,
    /// リネーム失敗時のトークン ("INVALID_FILENAME_CHARS" / "RENAME_FAILED")。
    /// タグ書き込み自体は成功しているので、フロントは警告表示のみ行う。
    pub rename_error: Option<String>,
}

/// 曲のタグを書き換える。開けない・書き込めないときは Err を返し、フロント (handleSaveEdit) は DB も更新しない。
#[tauri::command]
pub fn edit_track_metadata(app: tauri::AppHandle, payload: EditTrackPayload) -> Result<EditTrackResponse> {
    let mut file = platform::open_for_edit(&app, &payload.path)?;
    write_tags(&mut file, &payload)?;
    // 書き込みを確定して閉じてからリネームする
    drop(file);

    // デスクトップ版はファイル名のリネームを行わない
    #[cfg(target_os = "android")]
    if payload.rename_to_title {
        return Ok(rename_to_title(&app, &payload));
    }
    Ok(EditTrackResponse::default())
}

fn write_tags(file: &mut File, payload: &EditTrackPayload) -> Result<()> {
    // Android の fd にはパスが無いので中身からフォーマットを推定し、分からなければ拡張子を使う
    let mut probe = Probe::new(&mut *file).guess_file_type()?;
    if probe.file_type().is_none() {
        if let Some(t) = FileType::from_path(&payload.path) {
            probe = probe.set_file_type(t);
        }
    }
    let mut tagged_file = probe.read()?;
    if tagged_file.primary_tag().is_none() {
        let tag_type = tagged_file.primary_tag_type();
        tagged_file.insert_tag(Tag::new(tag_type));
    }
    let tag = tagged_file.primary_tag_mut().expect("inserted above");

    tag.set_title(payload.title.clone());
    tag.set_artist(payload.artist.clone());
    match &payload.album {
        Some(album) if !album.is_empty() => tag.set_album(album.clone()),
        _ => {
            tag.remove_album();
        }
    }

    // read で進んだ位置を先頭へ戻してから同じファイルに書き込む
    file.rewind()?;
    tag.save_to(file, WriteOptions::default())?;
    Ok(())
}

/// ファイル名 (MediaStore の DISPLAY_NAME) をタイトルに合わせる。拡張子は元のものを使う。
/// タグの書き込みは成功しているので、失敗は Err にせず rename_error で返す。
#[cfg(target_os = "android")]
fn rename_to_title(app: &tauri::AppHandle, payload: &EditTrackPayload) -> EditTrackResponse {
    const FORBIDDEN: &[char] = &['/', '\\', ':', '*', '?', '"', '<', '>', '|'];
    if payload.title.contains(FORBIDDEN) {
        return EditTrackResponse { rename_error: Some("INVALID_FILENAME_CHARS".into()), ..Default::default() };
    }
    let display_name = match std::path::Path::new(&payload.path).extension().and_then(|e| e.to_str()) {
        Some(ext) if !ext.is_empty() => format!("{}.{ext}", payload.title),
        _ => payload.title.clone(),
    };
    match platform::rename_audio(app, &payload.path, display_name) {
        Ok(p) => EditTrackResponse { new_path: Some(p), ..Default::default() },
        Err(e) => EditTrackResponse { rename_error: Some(format!("RENAME_FAILED: {e}")), ..Default::default() },
    }
}
