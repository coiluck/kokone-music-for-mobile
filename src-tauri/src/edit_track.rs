use lofty::config::WriteOptions;
use lofty::file::TaggedFileExt;
use lofty::probe::Probe;
use lofty::tag::{Accessor, Tag, TagExt};

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

#[tauri::command]
pub fn edit_track_metadata(
    _app: tauri::AppHandle,
    payload: EditTrackPayload,
) -> Result<EditTrackResponse, String> {
    #[cfg(target_os = "android")]
    {
        use std::fs::File;
        use std::io::Seek;
        use std::os::fd::FromRawFd;

        // scoped storage 下では他アプリ作成ファイルを書き込むのに全ファイルアクセス権限が要る。
        // 未許可なら設定画面へ誘導した上で Err を返す (フロントの catch で DB/store も更新されない)。
        // 許可後にもう一度保存すれば書き込みに進む。
        // フロント (MusicItem.tsx) がこのトークンを検出してローカライズ済み案内を表示する。
        if !crate::android_media::request_manage_storage_permission(&_app)? {
            return Err("NEED_STORAGE_PERMISSION".into());
        }

        // scoped storage 環境では path から直接 open できないので、
        // path → MediaStore audio_id を解決して ContentResolver 経由で開く。
        // 見つからなければ書き込み先が無いので Err。
        let mut ids =
            crate::android_media::audio_ids_for_paths(&_app, vec![payload.path.clone()])?;
        let audio_id = ids
            .remove(&payload.path)
            .ok_or_else(|| format!("audio_id not found for path: {}", payload.path))?;

        // "rw" で fd を取得する。権限拒否・読み取り専用ボリューム等では Err になり、
        // フロント (handleSaveEdit) の catch に入って DB/store も更新されない。
        let fd = crate::android_media::open_audio_fd_rw(&_app, audio_id)?;

        // SAFETY: fd は Kotlin の detachFd() で所有権を切り離した有効な "rw" fd。
        // File が所有権を引き取り、drop 時に close する。
        let mut file = unsafe { File::from_raw_fd(fd) };

        // path ヒントが無いので magic bytes でフォーマットを推定する。
        // read() は reader を消費するため &mut file を渡して file の所有権を残し、
        // 後段の save_to で同じ fd へ書き戻す。
        let mut tagged_file = Probe::new(&mut file)
            .guess_file_type()
            .map_err(|e| format!("probe failed: {e}"))?
            .read()
            .map_err(|e| format!("read failed: {e}"))?;

        if tagged_file.primary_tag().is_none() {
            let tag_type = tagged_file.primary_tag_type();
            tagged_file.insert_tag(Tag::new(tag_type));
        }
        let tag = tagged_file.primary_tag_mut().unwrap();

        tag.set_title(payload.title.clone());
        tag.set_artist(payload.artist);
        match payload.album {
            Some(album) if !album.is_empty() => tag.set_album(album),
            _ => {
                tag.remove_album();
            }
        }

        // read で進んだ位置を先頭へ戻してから書き込む。
        file.rewind().map_err(|e| format!("seek failed: {e}"))?;
        tag.save_to(&mut file, WriteOptions::default())
            .map_err(|e| format!("save failed: {e}"))?;

        // 書き込みを確定 (flush) し fd を閉じてからリネームする。
        drop(file);

        // タイトル変更時はファイル名 (MediaStore DISPLAY_NAME) も追従させる。
        // タグ書き込みは既に成功しているので、リネーム失敗は Err にせず
        // rename_error トークンとして返し、フロントで警告表示だけ行う。
        let mut new_path = None;
        let mut rename_error = None;
        if payload.rename_to_title {
            const FORBIDDEN: &[char] = &['/', '\\', ':', '*', '?', '"', '<', '>', '|'];
            if payload.title.chars().any(|c| FORBIDDEN.contains(&c)) {
                rename_error = Some("INVALID_FILENAME_CHARS".to_string());
            } else {
                // 拡張子は元のファイルのものを維持する。
                let ext = std::path::Path::new(&payload.path)
                    .extension()
                    .and_then(|e| e.to_str());
                let display_name = match ext {
                    Some(ext) if !ext.is_empty() => format!("{}.{}", payload.title, ext),
                    _ => payload.title.clone(),
                };
                match crate::android_media::rename_audio_file(&_app, audio_id, display_name) {
                    Ok(p) if !p.is_empty() => new_path = Some(p),
                    Ok(_) => rename_error = Some("RENAME_FAILED".to_string()),
                    Err(e) => rename_error = Some(format!("RENAME_FAILED: {e}")),
                }
            }
        }

        Ok(EditTrackResponse {
            new_path,
            rename_error,
        })
    }

    #[cfg(not(target_os = "android"))]
    {
        use std::path::Path;

        let path = Path::new(&payload.path);
        let mut tagged_file = Probe::open(path)
            .map_err(|e| format!("probe failed: {e}"))?
            .read()
            .map_err(|e| format!("read failed: {e}"))?;

        if tagged_file.primary_tag().is_none() {
            let tag_type = tagged_file.primary_tag_type();
            tagged_file.insert_tag(Tag::new(tag_type));
        }
        let tag = tagged_file.primary_tag_mut().unwrap();

        tag.set_title(payload.title);
        tag.set_artist(payload.artist);
        match payload.album {
            Some(album) if !album.is_empty() => tag.set_album(album),
            _ => { tag.remove_album(); }
        }

        tag.save_to_path(path, WriteOptions::default())
            .map_err(|e| format!("save failed: {e}"))?;

        // デスクトップ版はファイル名のリネームを行わない。
        Ok(EditTrackResponse::default())
    }
}
