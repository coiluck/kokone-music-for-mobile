use symphonia::core::audio::{AudioBufferRef, Signal};
use symphonia::core::codecs::DecoderOptions;
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;
use ebur128::{EbuR128, Mode};
use std::fs::File;

pub struct AnalysisResult {
    pub lufs: f64,
    pub trailing_silence_ms: u64,
}

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

    // 無音検出用: 末尾のサンプルを記録
    // -70dBFS ≒ 振幅 0.000316 (= 10^(-70/20))
    const SILENCE_THRESHOLD: f32 = 0.000316;
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
            // 他フォーマット(S32, F64等)も必要なら同様に追加
            _ => {}
        }
    }

    // ラウドネス取得
    let lufs = ebu.loudness_global().unwrap_or(-14.0);

    // 末尾無音の計算
    // 末尾から遡って無音でなくなる位置を探す
    let trailing_silence_ms = calc_trailing_silence(&all_samples, sample_rate, SILENCE_THRESHOLD);

    Ok(AnalysisResult { lufs, trailing_silence_ms })
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