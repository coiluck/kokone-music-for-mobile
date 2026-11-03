use super::{is_supported, TrackMeta};
use crate::error::Result;
use lofty::prelude::*;
use lofty::probe::Probe;
use sha2::{Digest, Sha256};
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;
use tauri::AppHandle;
use walkdir::WalkDir;

pub struct Candidate {
    pub path: String,
}

/// フォルダ以下を再帰的にたどる。見つかるたびに `on_found(見つけた数, パス)` を呼ぶ。
pub fn list_candidates(
    _app: &AppHandle,
    folders: &[String],
    mut on_found: impl FnMut(usize, &str),
) -> Result<Vec<Candidate>> {
    let mut candidates = Vec::new();
    for folder in folders {
        for entry in WalkDir::new(folder).into_iter().filter_map(|e| e.ok()) {
            if !entry.file_type().is_file() {
                continue;
            }
            let Some(path) = entry.path().to_str() else { continue };
            if !is_supported(path) {
                continue;
            }
            candidates.push(Candidate { path: path.to_string() });
            on_found(candidates.len(), path);
        }
    }
    Ok(candidates)
}

/// ファイルが実際にあるかで判定する。
pub fn existence(_candidates: &[Candidate]) -> impl Fn(&str) -> bool {
    |path| Path::new(path).is_file()
}

pub fn read_meta(_app: &AppHandle, c: &Candidate) -> Option<TrackMeta> {
    let tagged = Probe::open(&c.path).and_then(|p| p.read()).ok()?;
    let tag = tagged.primary_tag();
    Some(TrackMeta {
        title: tag.and_then(|t| t.title()).map(|s| s.to_string()),
        artist: tag.and_then(|t| t.artist()).map(|s| s.to_string()),
        album: tag.and_then(|t| t.album()).map(|s| s.to_string()),
        duration_ms: tagged.properties().duration().as_millis() as i64,
    })
}

/// 曲の同一性の判定に使うハッシュ。mp3 はタグを書き換えても変わらないよう、ID3 を除いた部分だけを使う。
pub fn hash(_app: &AppHandle, c: &Candidate) -> Result<String> {
    let mut file = File::open(&c.path)?;
    let len = file.metadata()?.len();
    let (start, end) = if super::extension(&c.path) == "mp3" { mp3_audio_range(&mut file, len)? } else { (0, len) };

    let mut h = Sha256::new();
    file.seek(SeekFrom::Start(start))?;
    let mut remaining = end.saturating_sub(start);
    let mut buf = [0u8; 65536];
    while remaining > 0 {
        let to_read = remaining.min(buf.len() as u64) as usize;
        let n = file.read(&mut buf[..to_read])?;
        if n == 0 {
            break;
        }
        h.update(&buf[..n]);
        remaining -= n as u64;
    }
    Ok(format!("{:x}", h.finalize()))
}

/// 先頭の ID3v2 と末尾の ID3v1 (TAG) を除いた、オーディオ本体のバイト範囲。
fn mp3_audio_range(file: &mut File, len: u64) -> Result<(u64, u64)> {
    let mut start = 0;
    if len >= 10 {
        let mut header = [0u8; 10];
        file.read_exact(&mut header)?;
        if &header[0..3] == b"ID3" {
            let size = ((header[6] as u64) << 21)
                | ((header[7] as u64) << 14)
                | ((header[8] as u64) << 7)
                | (header[9] as u64);
            let has_footer = (header[5] & 0x10) != 0;
            start = (10 + size + if has_footer { 10 } else { 0 }).min(len);
        }
    }
    let mut end = len;
    if len >= 128 {
        file.seek(SeekFrom::Start(len - 128))?;
        let mut marker = [0u8; 3];
        file.read_exact(&mut marker)?;
        if &marker == b"TAG" {
            end = len - 128;
        }
    }
    Ok((start, end))
}

/// 解析のために曲を開く。デスクトップはパスをそのまま開ける。
pub struct AudioFiles;

impl AudioFiles {
    pub fn resolve(_app: &AppHandle, _paths: &[&str]) -> Result<Self> {
        Ok(Self)
    }

    pub fn open(&self, path: &str) -> Result<File> {
        Ok(File::open(path)?)
    }
}

pub fn open_for_edit(_app: &AppHandle, path: &str) -> Result<File> {
    Ok(File::options().read(true).write(true).open(path)?)
}

/// `threads` 本のスレッドで並列に回す。
pub fn for_each<T: Sync>(items: &[T], threads: usize, f: impl Fn(&T) + Sync + Send) -> Result<()> {
    use rayon::prelude::*;
    let pool = rayon::ThreadPoolBuilder::new().num_threads(threads).build().map_err(crate::error::Error::msg)?;
    pool.install(|| items.par_iter().for_each(f));
    Ok(())
}
