use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

// 進捗イベントの最小送信間隔。ループ内での IPC 送信を間引くために使用する。
const EMIT_INTERVAL: Duration = Duration::from_millis(50);

// フロントに送る進捗
//
// process_step は以下の4段階。
//   "scanning"  : ファイル列挙中
//   "deleting"  : 設定に適合しなくなったトラックをDBから削除中
//   "adding"    : 新規ファイルを INSERT 中（LUFS等は NULL のまま）
//   "analyzing" : バックグラウンドで LUFS / trailing_silence_ms を計算中
#[derive(Clone, serde::Serialize, Default)]
struct ScanProgress {
    process_step: &'static str,
    scan_current: u64,
    scan_total: u64,
    add_current: u64,
    add_total: u64,
    analyze_current: u64,
    analyze_total: u64,
    current_file: String,
}

/// "scan-progress" イベントの送信。ループ内から呼ぶものは EMIT_INTERVAL ごとに間引く。
/// 解析は並列に回るので、複数のスレッドから呼べるようにしてある。
pub struct Progress {
    app: AppHandle,
    last_emit: Mutex<Option<Instant>>,
}

impl Progress {
    pub fn new(app: &AppHandle) -> Self {
        Self { app: app.clone(), last_emit: Mutex::new(None) }
    }

    /// 列挙中は総数が決まっていないので scan_total は 0。
    pub fn scanning(&self, found: usize, path: &str) {
        self.throttled(ScanProgress {
            process_step: "scanning",
            scan_current: found as u64,
            current_file: file_name(path),
            ..Default::default()
        });
    }

    pub fn deleting(&self) {
        self.send(ScanProgress { process_step: "deleting", ..Default::default() });
    }

    pub fn adding(&self, done: usize, total: usize, path: &str) {
        self.throttled(adding(done, total, path));
    }

    /// 追加の完了。フロントはここで画面を一旦更新する。
    pub fn added(&self, total: usize) {
        self.send(adding(total, total, ""));
    }

    /// 最後の 1 曲は間引かずに送る。
    pub fn analyzing(&self, done: usize, total: usize, path: &str) {
        let p = ScanProgress {
            process_step: "analyzing",
            analyze_current: done as u64,
            analyze_total: total as u64,
            current_file: file_name(path),
            ..Default::default()
        };
        if done == total {
            self.send(p);
        } else {
            self.throttled(p);
        }
    }

    fn throttled(&self, p: ScanProgress) {
        let mut last = self.last_emit.lock().unwrap();
        if last.map_or(true, |t| t.elapsed() >= EMIT_INTERVAL) {
            *last = Some(Instant::now());
            drop(last);
            self.send(p);
        }
    }

    fn send(&self, p: ScanProgress) {
        let _ = self.app.emit("scan-progress", p);
    }
}

fn adding(done: usize, total: usize, path: &str) -> ScanProgress {
    ScanProgress {
        process_step: "adding",
        scan_current: total as u64,
        scan_total: total as u64,
        add_current: done as u64,
        add_total: total as u64,
        current_file: file_name(path),
        ..Default::default()
    }
}

fn file_name(path: &str) -> String {
    std::path::Path::new(path).file_name().and_then(|n| n.to_str()).unwrap_or("").to_string()
}
