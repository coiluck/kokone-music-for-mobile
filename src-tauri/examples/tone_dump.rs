//! 曲調モデルの学習用に、フォルダ内の曲の特徴量を JSON Lines で書き出す。
//! アプリと同じ tone_analysis::extract_file を使うので、学習と推論で特徴量の計算がずれない。
//!
//! 使い方: cargo run --release --example tone_dump -- <曲フォルダ> <出力.jsonl>

use kokone_music_lib::{audio_analysis, tone_analysis};
use rayon::prelude::*;
use std::io::Write;
use std::path::Path;
use std::sync::Mutex;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let (dir, out) = (Path::new(&args[1]), &args[2]);
    let files: Vec<_> = walkdir::WalkDir::new(dir)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
        .map(|e| e.into_path())
        .filter(|p| p.extension().and_then(|e| e.to_str()).is_some_and(|e| e.eq_ignore_ascii_case("mp3")))
        .collect();
    let writer = Mutex::new(std::fs::File::create(out).expect("cannot create output"));
    let done = std::sync::atomic::AtomicUsize::new(0);
    files.par_iter().for_each(|path| {
        let p = path.to_string_lossy();
        let rel = path.strip_prefix(dir).unwrap_or(path).to_string_lossy().replace('\\', "/");
        let row = match (tone_analysis::extract_file(&p), audio_analysis::analyze_audio(&p)) {
            (Ok(f), lufs) => serde_json::json!({
                "path": rel,
                "lufs": lufs.ok().map(|a| a.lufs),
                "feats": f.values.into_iter().map(|(n, v)| (n, v.into())).collect::<serde_json::Map<_, _>>(),
                "emb": f.embedding,
            }),
            (Err(e), _) => {
                eprintln!("skip {rel}: {e}");
                return;
            }
        };
        writeln!(writer.lock().unwrap(), "{row}").expect("write failed");
        let n = done.fetch_add(1, std::sync::atomic::Ordering::Relaxed) + 1;
        if n % 20 == 0 {
            eprintln!("{n}/{}", files.len());
        }
    });
}
