use symphonia::core::audio::{AudioBufferRef, Signal};
use symphonia::core::codecs::DecoderOptions;
use symphonia::core::formats::{FormatOptions, SeekMode, SeekTo};
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;
use symphonia::core::units::Time;
use ebur128::{EbuR128, Mode};
use std::fs::File;

pub struct AnalysisResult {
    pub lufs: f64,
    pub trailing_silence_ms: u64,
}

// -70dBFS ≒ 振幅 0.000316 (= 10^(-70/20))
const SILENCE_THRESHOLD: f32 = 0.000316;

pub fn analyze_audio(file_path: &str) -> Result<AnalysisResult, Box<dyn std::error::Error>> {
    // ファイルを開いてsymphoniaでプローブ
    let file = File::open(file_path)?;
    let mss = MediaSourceStream::new(Box::new(file), Default::default());

    let mut hint = Hint::new();
    if let Some(ext) = std::path::Path::new(file_path).extension().and_then(|e| e.to_str()) {
        hint.with_extension(ext);
    }

    let probed = symphonia::default::get_probe().format(
        &hint,
        mss,
        &FormatOptions::default(),
        &MetadataOptions::default(),
    )?;

    let mut format = probed.format;
    let track = format.default_track().ok_or("No track found")?;
    let sample_rate = track.codec_params.sample_rate.ok_or("No sample rate")?;
    let channels = track.codec_params.channels.ok_or("No channels")?.count();
    let track_id = track.id;

    let mut decoder = symphonia::default::get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())?;

    // EBU R128 ラウドネス計測の初期化
    let ebur_channels = channels.try_into()?;
    let mut ebu = EbuR128::new(ebur_channels, sample_rate, Mode::I)?;

    let mut all_samples: Vec<f32> = Vec::new(); // 末尾無音検出用に全サンプルを保持

    // デコードループ
    loop {
        let packet = match format.next_packet() {
            Ok(p) => p,
            Err(_) => break,
        };
        if packet.track_id() != track_id {
            continue;
        }

        let decoded = match decoder.decode(&packet) {
            Ok(d) => d,
            Err(_) => continue,
        };

        // EBU R128にサンプルを追加 & 末尾無音用に収集
        match &decoded {
            AudioBufferRef::F32(buf) => {
                // EBU R128
                let frames = buf.frames();
                let mut interleaved: Vec<f32> = Vec::with_capacity(frames * channels);
                for frame_idx in 0..frames {
                    for ch in 0..channels {
                        interleaved.push(buf.chan(ch)[frame_idx]);
                    }
                }
                ebu.add_frames_f32(&interleaved)?;

                // 末尾無音用: モノラルミックスで保存
                for frame_idx in 0..frames {
                    let mono: f32 = (0..channels)
                        .map(|ch| buf.chan(ch)[frame_idx])
                        .sum::<f32>() / channels as f32;
                    all_samples.push(mono);
                }
            }
            AudioBufferRef::S16(buf) => {
                let frames = buf.frames();
                let mut interleaved: Vec<f32> = Vec::with_capacity(frames * channels);
                for frame_idx in 0..frames {
                    for ch in 0..channels {
                        let s = buf.chan(ch)[frame_idx] as f32 / 32768.0;
                        interleaved.push(s);
                    }
                }
                ebu.add_frames_f32(&interleaved)?;

                for frame_idx in 0..frames {
                    let mono: f32 = (0..channels)
                        .map(|ch| buf.chan(ch)[frame_idx] as f32 / 32768.0)
                        .sum::<f32>() / channels as f32;
                    all_samples.push(mono);
                }
            }
            AudioBufferRef::S24(buf) => {
                // S24は24ビットの最大値で割って正規化 (2^23 = 8388608)
                // symphonia の i24 型は .inner フィールドで i32 にアクセスできる
                let frames = buf.frames();
                let mut interleaved: Vec<f32> = Vec::with_capacity(frames * channels);
                for frame_idx in 0..frames {
                    for ch in 0..channels {
                        let s = buf.chan(ch)[frame_idx].inner() as f32 / 8388608.0;
                        interleaved.push(s);
                    }
                }
                ebu.add_frames_f32(&interleaved)?;

                for frame_idx in 0..frames {
                    let mono: f32 = (0..channels)
                        .map(|ch| buf.chan(ch)[frame_idx].inner() as f32 / 8388608.0)
                        .sum::<f32>() / channels as f32;
                    all_samples.push(mono);
                }
            }
            // 他フォーマット(S32, F64等)も必要なら同様に追加
            _ => {
                log::warn!("Unsupported audio format encountered, skipping.");
            }
        }
    }

    // ラウドネス取得
    let lufs = ebu.loudness_global().unwrap_or(-14.0);

    // 末尾無音の計算
    // 末尾から遡って無音でなくなる位置を探す
    let trailing_silence_ms = calc_trailing_silence(&all_samples, sample_rate, SILENCE_THRESHOLD);

    Ok(AnalysisResult { lufs, trailing_silence_ms })
}

/// ファイルの末尾20秒のみを読み込んで trailing_silence_ms を計算する。
/// ReplayGain等で既にLUFSが取得済みで、trailing_silence_msのみが必要な場合に使用する。
/// analyze_audio とは独立して動作し、全サンプルをメモリに保持しない。
///
/// 可能であれば Symphonia の seek 機能を使ってファイル先頭から全体をデコードせず、
/// 末尾20秒付近に直接ジャンプする。
pub fn analyze_trailing_silence(file_path: &str) -> Result<u64, Box<dyn std::error::Error>> {
    const TAIL_SECONDS: u64 = 20;

    let file = File::open(file_path)?;
    let mss = MediaSourceStream::new(Box::new(file), Default::default());

    let mut hint = Hint::new();
    if let Some(ext) = std::path::Path::new(file_path).extension().and_then(|e| e.to_str()) {
        hint.with_extension(ext);
    }

    let probed = symphonia::default::get_probe().format(
        &hint,
        mss,
        &FormatOptions::default(),
        &MetadataOptions::default(),
    )?;

    let mut format = probed.format;
    let track = format.default_track().ok_or("No track found")?;
    let sample_rate = track.codec_params.sample_rate.ok_or("No sample rate")?;
    let channels = track.codec_params.channels.ok_or("No channels")?.count();
    let track_id = track.id;
    let n_frames = track.codec_params.n_frames;

    let mut decoder = symphonia::default::get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())?;

    // --- 末尾20秒付近にシーク ---
    // 総時間が分かる場合のみ試みる。不明もしくは20秒以下ならシークせず最初から読む。
    if let Some(total_frames) = n_frames {
        let total_seconds = total_frames as f64 / sample_rate as f64;
        if total_seconds > TAIL_SECONDS as f64 {
            let target_seconds = total_seconds - TAIL_SECONDS as f64;
            let secs = target_seconds.trunc() as u64;
            let frac = target_seconds.fract();

            // シーク失敗時はフォールバックで先頭から読む（エラーにはしない）
            let _ = format.seek(
                SeekMode::Accurate,
                SeekTo::Time {
                    time: Time::new(secs, frac),
                    track_id: Some(track_id),
                },
            );
            // seek 後は decoder の内部状態をリセット
            decoder.reset();
        }
    }

    // 末尾20秒分のサンプル数
    let tail_capacity = sample_rate as usize * TAIL_SECONDS as usize;

    // リングバッファ方式: 常に直近 tail_capacity サンプルのみを保持する。
    // seek が coarse で行き過ぎた場合や、n_frames が不明でシークできなかった
    // 場合でも、このリングバッファがあれば末尾20秒分だけ確実に残る。
    let mut tail: std::collections::VecDeque<f32> =
        std::collections::VecDeque::with_capacity(tail_capacity + 1);

    // デコードループ
    loop {
        let packet = match format.next_packet() {
            Ok(p) => p,
            Err(_) => break,
        };
        if packet.track_id() != track_id {
            continue;
        }

        let decoded = match decoder.decode(&packet) {
            Ok(d) => d,
            Err(_) => continue,
        };

        match &decoded {
            AudioBufferRef::F32(buf) => {
                let frames = buf.frames();
                for frame_idx in 0..frames {
                    let mono: f32 = (0..channels)
                        .map(|ch| buf.chan(ch)[frame_idx])
                        .sum::<f32>() / channels as f32;
                    tail.push_back(mono);
                    if tail.len() > tail_capacity {
                        tail.pop_front();
                    }
                }
            }
            AudioBufferRef::S16(buf) => {
                let frames = buf.frames();
                for frame_idx in 0..frames {
                    let mono: f32 = (0..channels)
                        .map(|ch| buf.chan(ch)[frame_idx] as f32 / 32768.0)
                        .sum::<f32>() / channels as f32;
                    tail.push_back(mono);
                    if tail.len() > tail_capacity {
                        tail.pop_front();
                    }
                }
            }
            AudioBufferRef::S24(buf) => {
                // S24は24ビットの最大値で割って正規化 (2^23 = 8388608)
                let frames = buf.frames();
                for frame_idx in 0..frames {
                    let mono: f32 = (0..channels)
                        .map(|ch| buf.chan(ch)[frame_idx].inner() as f32 / 8388608.0)
                        .sum::<f32>() / channels as f32;
                    tail.push_back(mono);
                    if tail.len() > tail_capacity {
                        tail.pop_front();
                    }
                }
            }
            // 他フォーマット(S32, F64等)も必要なら同様に追加
            _ => {
                log::warn!("Unsupported audio format encountered, skipping.");
            }
        }
    }

    // VecDeque を slice に変換して既存ロジックに流し込む
    let samples: Vec<f32> = tail.into_iter().collect();
    Ok(calc_trailing_silence(&samples, sample_rate, SILENCE_THRESHOLD))
}

fn calc_trailing_silence(samples: &[f32], sample_rate: u32, threshold: f32) -> u64 {
    // 末尾から最初に閾値を超えるサンプルを探す
    let last_loud_idx = samples
        .iter()
        .rposition(|&s| s.abs() > threshold);

    match last_loud_idx {
        None => 0, // 全体が無音（異常ケース）
        Some(idx) => {
            let silent_samples = samples.len() - 1 - idx;
            let silence_ms = (silent_samples as f64 / sample_rate as f64 * 1000.0) as u64;

            // 500ms以上の末尾無音のみ有効（ffmpeg版と同じロジック）
            if silence_ms >= 500 {
                silence_ms - 500
            } else {
                0
            }
        }
    }
}
