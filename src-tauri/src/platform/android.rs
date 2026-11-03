use super::{is_supported, TrackMeta};
use crate::error::{Error, Result};
use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::os::fd::FromRawFd;
use tauri::AppHandle;
use tauri_plugin_android_media::{
    AndroidMediaExt, AudioHashRequest, AudioIdsForPathsRequest, AudioMeta, OpenAudioFdRequest,
    RenameAudioFileRequest,
};

pub struct Candidate {
    pub path: String,
    meta: AudioMeta,
}

/// MediaStore に登録済みの曲のうち、フォルダ内にあるもの。見つかるたびに `on_found(見つけた数, パス)` を呼ぶ。
pub fn list_candidates(
    app: &AppHandle,
    folders: &[String],
    mut on_found: impl FnMut(usize, &str),
) -> Result<Vec<Candidate>> {
    let mut candidates = Vec::new();
    for meta in app.android_media().query_audio_metadata()?.items {
        if !folders.iter().any(|f| meta.display_path.starts_with(f)) || !is_supported(&meta.display_path) {
            continue;
        }
        candidates.push(Candidate { path: meta.display_path.clone(), meta });
        let c = candidates.last().expect("just pushed");
        on_found(candidates.len(), &c.path);
    }
    Ok(candidates)
}

/// Rust からはファイルの有無を確かめられない (EACCES で常に無い扱いになる) ので、
/// MediaStore の一覧に載っているかで判定する。
pub fn existence(candidates: &[Candidate]) -> impl Fn(&str) -> bool + '_ {
    let listed: HashSet<&str> = candidates.iter().map(|c| c.path.as_str()).collect();
    move |path| listed.contains(path)
}

pub fn read_meta(_app: &AppHandle, c: &Candidate) -> Option<TrackMeta> {
    let non_empty = |s: &str| (!s.is_empty()).then(|| s.to_string());
    Some(TrackMeta {
        title: non_empty(&c.meta.title),
        artist: non_empty(&c.meta.artist),
        album: non_empty(&c.meta.album),
        duration_ms: c.meta.duration_ms,
    })
}

/// ハッシュの計算は Kotlin 側 (MediaStoreHelper.audioHash) で行う。
pub fn hash(app: &AppHandle, c: &Candidate) -> Result<String> {
    let is_mp3 = super::extension(&c.path) == "mp3";
    let hash = app.android_media().audio_hash(AudioHashRequest { audio_id: c.meta.id, is_mp3 })?.hash;
    if hash.is_empty() {
        return Err(format!("audio_hash returned empty for id={}", c.meta.id).into());
    }
    Ok(hash)
}

/// 解析のために曲を開く。パスから MediaStore の audio_id を先にまとめて引いておく。
pub struct AudioFiles {
    app: AppHandle,
    ids: HashMap<String, i64>,
}

impl AudioFiles {
    pub fn resolve(app: &AppHandle, paths: &[&str]) -> Result<Self> {
        Ok(Self { app: app.clone(), ids: audio_ids(app, paths)? })
    }

    pub fn open(&self, path: &str) -> Result<File> {
        let id = *self.ids.get(path).ok_or_else(|| format!("not in MediaStore: {path}"))?;
        open_fd(&self.app, id, false)
    }
}

/// タグを書き込むために開く。全ファイルアクセスが未許可なら設定画面を開いて NeedStoragePermission を返す
/// (他のアプリが作ったファイルに書き込むのに必要)。許可してからもう一度保存すれば書き込める。
pub fn open_for_edit(app: &AppHandle, path: &str) -> Result<File> {
    if !app.android_media().request_manage_storage_permission()?.granted {
        return Err(Error::NeedStoragePermission);
    }
    open_fd(app, audio_id(app, path)?, true)
}

/// MediaStore 上のファイル名を `display_name` (拡張子込み) に変え、変更後のパスを返す。
/// 同名のファイルがあれば Kotlin 側で末尾に連番を付ける。
pub fn rename_audio(app: &AppHandle, path: &str, display_name: String) -> Result<String> {
    let audio_id = audio_id(app, path)?;
    let new_path = app.android_media().rename_audio_file(RenameAudioFileRequest { audio_id, display_name })?.new_path;
    if new_path.is_empty() {
        return Err("rename returned no path".into());
    }
    Ok(new_path)
}

/// JNI はスレッドへの attach が要るので、並列にせず呼び出し元のスレッドで順に回す。
pub fn for_each<T: Sync>(items: &[T], _threads: usize, f: impl Fn(&T) + Sync + Send) -> Result<()> {
    items.iter().for_each(f);
    Ok(())
}

/// パスを MediaStore の audio_id に変える (見つかったパスだけ map に入る)。
fn audio_ids(app: &AppHandle, paths: &[&str]) -> Result<HashMap<String, i64>> {
    if paths.is_empty() {
        return Ok(HashMap::new());
    }
    let paths = paths.iter().map(|p| p.to_string()).collect();
    Ok(app.android_media().audio_ids_for_paths(AudioIdsForPathsRequest { paths })?.ids)
}

fn audio_id(app: &AppHandle, path: &str) -> Result<i64> {
    audio_ids(app, &[path])?.remove(path).ok_or_else(|| format!("audio_id not found for path: {path}").into())
}

/// Kotlin で開いて detachFd() した fd を File にする。File が drop されると close される。
fn open_fd(app: &AppHandle, audio_id: i64, writable: bool) -> Result<File> {
    let fd = app.android_media().open_audio_fd(OpenAudioFdRequest { audio_id, writable })?.fd;
    if fd < 0 {
        return Err(format!("openAudioFd returned invalid fd for id={audio_id}").into());
    }
    // SAFETY: fd は Kotlin 側で所有権を切り離した有効な fd で、ほかに持ち主はいない。
    Ok(unsafe { File::from_raw_fd(fd) })
}
