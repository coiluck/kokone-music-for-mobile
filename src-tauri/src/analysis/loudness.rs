//! ラウドネス (EBU R128 の統合ラウドネス) と末尾の無音の長さ。

use super::open_track;
use crate::error::Result;
use ebur128::{EbuR128, Mode};
use std::fs::File;
use symphonia::core::audio::SampleBuffer;

pub struct Loudness {
    pub lufs: f64,
    pub trailing_silence_ms: u64,
}

// -70dBFS ≒ 振幅 0.000316 (= 10^(-70/20))
const SILENCE_THRESHOLD: f32 = 0.000316;

// 末尾の有効な音とみなすために除外する固定マージン (ms)。
// ffmpeg 版のロジックと揃えてある。
const TRAILING_SILENCE_MARGIN_MS: u64 = 500;

/// `ext` はフォーマット推定のヒント (拡張子)。
pub fn analyze(file: File, ext: &str) -> Result<Loudness> {
    let (mut format, mut decoder, track_id) = open_track(file, ext)?;
    let params = decoder.codec_params();
    let sample_rate = params.sample_rate.ok_or("No sample rate")?;
    let channels = params.channels.ok_or("No channels")?.count();
    let mut ebu = EbuR128::new(channels as u32, sample_rate, Mode::I)?;

    // 全サンプルを持たず、最後に閾値を超えたモノラルサンプルの位置だけを覚える
    // (1 曲で数十 MB になるのを避ける。並列に解析するのでピークメモリに効く)。
    let mut total_samples: u64 = 0;
    let mut last_loud_sample_idx: Option<u64> = None;
    let mut buf: Option<SampleBuffer<f32>> = None;
    while let Ok(packet) = format.next_packet() {
        if packet.track_id() != track_id {
            continue;
        }
        let Ok(decoded) = decoder.decode(&packet) else { continue };
        let spec = *decoded.spec();
        if buf.as_ref().map_or(true, |b| b.capacity() < decoded.capacity() * channels) {
            buf = Some(SampleBuffer::new(decoded.capacity() as u64, spec));
        }
        let b = buf.as_mut().expect("allocated above");
        b.copy_interleaved_ref(decoded);
        ebu.add_frames_f32(b.samples())?;
        for frame in b.samples().chunks_exact(channels) {
            let mono = frame.iter().sum::<f32>() / channels as f32;
            if mono.abs() > SILENCE_THRESHOLD {
                last_loud_sample_idx = Some(total_samples);
            }
            total_samples += 1;
        }
    }
    if total_samples == 0 {
        return Err("no audio samples decoded".into());
    }
    Ok(Loudness {
        lufs: ebu.loudness_global()?,
        trailing_silence_ms: trailing_silence_ms(total_samples, last_loud_sample_idx, sample_rate),
    })
}

/// 末尾の無音の長さ (ms)。`last_loud_idx` が None (全体が無音) なら 0。
/// 末尾マージン (TRAILING_SILENCE_MARGIN_MS) ぶんは「正常な余韻」として差し引く。
fn trailing_silence_ms(total_samples: u64, last_loud_idx: Option<u64>, sample_rate: u32) -> u64 {
    let Some(idx) = last_loud_idx else {
        return 0;
    };
    let silent_samples = total_samples.saturating_sub(1).saturating_sub(idx);
    let silence_ms = (silent_samples as f64 / sample_rate as f64 * 1000.0) as u64;
    silence_ms.saturating_sub(TRAILING_SILENCE_MARGIN_MS)
}
