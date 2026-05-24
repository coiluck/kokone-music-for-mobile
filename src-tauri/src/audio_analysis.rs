use ebur128::{EbuR128, Mode};
use std::fs::File;
use symphonia::core::audio::{AudioBufferRef, Signal};
use symphonia::core::codecs::DecoderOptions;
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;

pub struct AnalysisResult {
    pub lufs: f64,
    pub trailing_silence_ms: u64,
}

// -70dBFS ≒ 振幅 0.000316 (= 10^(-70/20))
const SILENCE_THRESHOLD: f32 = 0.000316;

// PCM 正規化係数（[-1.0, 1.0] レンジへ落とすための除数）。
// i16/i24 の負側フルスケール (|MIN|) を 1.0 に対応させる慣用値。
const NORMALIZE_S16: f32 = 32768.0; // 2^15
const NORMALIZE_S24: f32 = 8388608.0; // 2^23

// 末尾の有効な音とみなすために除外する固定マージン (ms)。
// ffmpeg 版のロジックと揃えてある。
const TRAILING_SILENCE_MARGIN_MS: u64 = 500;

pub fn analyze_audio(file_path: &str) -> Result<AnalysisResult, Box<dyn std::error::Error>> {
    let file = File::open(file_path)?;
    let mss = MediaSourceStream::new(Box::new(file), Default::default());

    let mut hint = Hint::new();
    if let Some(ext) = std::path::Path::new(file_path)
        .extension()
        .and_then(|e| e.to_str())
    {
        hint.with_extension(ext);
    }

    analyze_media_source(mss, hint)
}

/// 生の fd からファイルを開いて解析する (Android の scoped storage 向け)。
/// fd の所有権はこの関数に移り、`File` の drop 時に close される。
/// `ext` は symphonia のフォーマット推定用ヒント (拡張子)。
#[cfg(target_os = "android")]
pub fn analyze_fd(fd: i32, ext: &str) -> Result<AnalysisResult, Box<dyn std::error::Error>> {
    use std::os::fd::FromRawFd;

    // SAFETY: fd は Kotlin の detachFd() で所有権を切り離した有効な読み取り fd。
    // File が所有権を引き取り、drop 時に close する。
    let file = unsafe { File::from_raw_fd(fd) };
    let mss = MediaSourceStream::new(Box::new(file), Default::default());

    let mut hint = Hint::new();
    if !ext.is_empty() {
        hint.with_extension(ext);
    }

    analyze_media_source(mss, hint)
}

fn analyze_media_source(
    mss: MediaSourceStream,
    hint: Hint,
) -> Result<AnalysisResult, Box<dyn std::error::Error>> {
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

    // 末尾無音検出は「全サンプルを保持して後から rposition」ではなく、
    // ループ中にストリーミングで状態を更新する方式に変更している。
    //   total_samples       : 処理したモノラルサンプル数
    //   last_loud_sample_idx: 最後に閾値を超えたサンプルのインデックス
    // これにより 1 ファイル分のメモリ消費が数十MB → 数バイトになる。
    // 並列解析時のピークメモリを大幅に下げるための最適化。
    let mut total_samples: u64 = 0;
    let mut last_loud_sample_idx: Option<u64> = None;

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
                let mut interleaved: Vec<f32> = Vec::with_capacity(frames * channels);
                for frame_idx in 0..frames {
                    for ch in 0..channels {
                        interleaved.push(buf.chan(ch)[frame_idx]);
                    }
                }
                ebu.add_frames_f32(&interleaved)?;

                for frame_idx in 0..frames {
                    let mono: f32 = (0..channels)
                        .map(|ch| buf.chan(ch)[frame_idx])
                        .sum::<f32>()
                        / channels as f32;
                    if mono.abs() > SILENCE_THRESHOLD {
                        last_loud_sample_idx = Some(total_samples);
                    }
                    total_samples += 1;
                }
            }
            AudioBufferRef::S16(buf) => {
                let frames = buf.frames();
                let mut interleaved: Vec<f32> = Vec::with_capacity(frames * channels);
                for frame_idx in 0..frames {
                    for ch in 0..channels {
                        let s = buf.chan(ch)[frame_idx] as f32 / NORMALIZE_S16;
                        interleaved.push(s);
                    }
                }
                ebu.add_frames_f32(&interleaved)?;

                for frame_idx in 0..frames {
                    let mono: f32 = (0..channels)
                        .map(|ch| buf.chan(ch)[frame_idx] as f32 / NORMALIZE_S16)
                        .sum::<f32>()
                        / channels as f32;
                    if mono.abs() > SILENCE_THRESHOLD {
                        last_loud_sample_idx = Some(total_samples);
                    }
                    total_samples += 1;
                }
            }
            AudioBufferRef::S24(buf) => {
                let frames = buf.frames();
                let mut interleaved: Vec<f32> = Vec::with_capacity(frames * channels);
                for frame_idx in 0..frames {
                    for ch in 0..channels {
                        let s = buf.chan(ch)[frame_idx].inner() as f32 / NORMALIZE_S24;
                        interleaved.push(s);
                    }
                }
                ebu.add_frames_f32(&interleaved)?;

                for frame_idx in 0..frames {
                    let mono: f32 = (0..channels)
                        .map(|ch| buf.chan(ch)[frame_idx].inner() as f32 / NORMALIZE_S24)
                        .sum::<f32>()
                        / channels as f32;
                    if mono.abs() > SILENCE_THRESHOLD {
                        last_loud_sample_idx = Some(total_samples);
                    }
                    total_samples += 1;
                }
            }
            _ => {
                log::warn!("Unsupported audio format encountered, skipping.");
            }
        }
    }

    if total_samples == 0 {
        return Err("no audio samples decoded".into());
    }

    let lufs = ebu.loudness_global()?;

    let trailing_silence_ms =
        calc_trailing_silence(total_samples, last_loud_sample_idx, sample_rate);

    Ok(AnalysisResult {
        lufs,
        trailing_silence_ms,
    })
}

/// 末尾の無音長（ms）を計算する。
/// `last_loud_idx` が None の場合は全体無音として 0 を返す。
/// 末尾マージン (TRAILING_SILENCE_MARGIN_MS) ぶんは「正常な余韻」として差し引く。
fn calc_trailing_silence(
    total_samples: u64,
    last_loud_idx: Option<u64>,
    sample_rate: u32,
) -> u64 {
    let Some(idx) = last_loud_idx else {
        return 0;
    };
    if total_samples == 0 {
        return 0;
    }

    let silent_samples = total_samples.saturating_sub(1).saturating_sub(idx);
    let silence_ms = (silent_samples as f64 / sample_rate as f64 * 1000.0) as u64;

    if silence_ms >= TRAILING_SILENCE_MARGIN_MS {
        silence_ms - TRAILING_SILENCE_MARGIN_MS
    } else {
        0
    }
}
