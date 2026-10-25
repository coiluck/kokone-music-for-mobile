//! 曲調 (エネルギー 3 段階 × 明暗 2 段階) の推定。
//!
//! 音声 → 16kHz モノラル → (a) Essentia の effnet と分類ヘッド (b) 信号特徴 (c) 和声特徴
//! → 学習済みの線形モデル (models/tone_weights.json) でスコア化する。
//! 重みの作り直しは tools/tone-model/README.md を参照。

mod dsp;
mod model;

use dsp::{mean, percentile, std, SR};
use model::{Models, Weights, N_PATCHES};
use std::fs::File;
use symphonia::core::audio::SampleBuffer;
use symphonia::core::codecs::DecoderOptions;
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;

/// 自動で付けるエネルギーのタグ。添字がレベル (0 = 低, 1 = 中, 2 = 高)。
pub const ENERGY_TAGS: [&str; 3] = ["静", "動", "激"];
/// 自動で付ける明暗のタグ。添字 0 = 明, 1 = 暗。
pub const MOOD_TAGS: [&str; 2] = ["明", "暗"];

/// 曲調のスコア。
pub struct Tone {
    /// 0〜2 程度。0.5 / 1.5 で 低 / 中 / 高 に分ける。
    pub energy_score: f32,
    /// 0〜1 程度。0.5 より大きければ明。
    pub mood_score: f32,
}

impl Tone {
    pub fn energy_tag(&self) -> &'static str {
        ENERGY_TAGS[if self.energy_score < 0.5 { 0 } else if self.energy_score < 1.5 { 1 } else { 2 }]
    }

    pub fn mood_tag(&self) -> &'static str {
        MOOD_TAGS[if self.mood_score > 0.5 { 0 } else { 1 }]
    }
}

/// 曲ごとの生の特徴量 (標準化前)。
pub struct Features {
    pub values: Vec<(String, f32)>,
    /// effnet 埋め込みのパッチ平均 (1280 次元)
    pub embedding: Vec<f32>,
}

impl Features {
    fn get(&self, name: &str) -> Option<f32> {
        self.values.iter().find(|(n, _)| n == name).map(|(_, v)| *v)
    }
}

pub fn analyze_file(path: &str, lufs: Option<f64>) -> Result<Tone, String> {
    predict(&extract_file(path)?, lufs)
}

/// 生の fd から解析する (Android の scoped storage 向け)。fd の所有権はこの関数に移る。
#[cfg(target_os = "android")]
pub fn analyze_fd(fd: i32, ext: &str, lufs: Option<f64>) -> Result<Tone, String> {
    use std::os::fd::FromRawFd;
    // SAFETY: fd は Kotlin の detachFd() で所有権を切り離した有効な読み取り fd。
    let file = unsafe { File::from_raw_fd(fd) };
    let samples = decode_mono_16k(MediaSourceStream::new(Box::new(file), Default::default()), ext)?;
    predict(&extract(&samples)?, lufs)
}

pub fn predict(f: &Features, lufs: Option<f64>) -> Result<Tone, String> {
    let w = Weights::get()?;
    let value = |n: &str| f.get(n);
    Ok(Tone {
        energy_score: w.energy_score(&value, lufs.map(|v| v as f32), &f.embedding)?,
        mood_score: w.mood_score(&value)?,
    })
}

/// ファイルを読んで特徴量を出す (学習用の特徴量書き出しにも使う)。
pub fn extract_file(path: &str) -> Result<Features, String> {
    let file = File::open(path).map_err(|e| e.to_string())?;
    let ext = std::path::Path::new(path).extension().and_then(|e| e.to_str()).unwrap_or("");
    let samples = decode_mono_16k(MediaSourceStream::new(Box::new(file), Default::default()), ext)?;
    extract(&samples)
}

// ---------------------------------------------------------------------------
// デコード
// ---------------------------------------------------------------------------

fn decode_mono_16k(mss: MediaSourceStream, ext: &str) -> Result<Vec<f32>, String> {
    let mut hint = Hint::new();
    if !ext.is_empty() {
        hint.with_extension(ext);
    }
    let probed = symphonia::default::get_probe()
        .format(&hint, mss, &FormatOptions::default(), &MetadataOptions::default())
        .map_err(|e| e.to_string())?;
    let mut format = probed.format;
    let track = format.default_track().ok_or("No track found")?;
    let sample_rate = track.codec_params.sample_rate.ok_or("No sample rate")?;
    let track_id = track.id;
    let mut decoder = symphonia::default::get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())
        .map_err(|e| e.to_string())?;

    // ステレオのまま貯めるとメモリが倍になるので、パケットごとにモノラルへ落とす
    let mut mono: Vec<f32> = Vec::new();
    let mut buf: Option<SampleBuffer<f32>> = None;
    while let Ok(packet) = format.next_packet() {
        if packet.track_id() != track_id {
            continue;
        }
        let Ok(decoded) = decoder.decode(&packet) else { continue };
        let spec = *decoded.spec();
        let channels = spec.channels.count();
        if buf.as_ref().map_or(true, |b| b.capacity() < decoded.capacity() * channels) {
            buf = Some(SampleBuffer::new(decoded.capacity() as u64, spec));
        }
        let b = buf.as_mut().expect("allocated above");
        b.copy_interleaved_ref(decoded);
        mono.extend(b.samples().chunks_exact(channels).map(|c| c.iter().sum::<f32>() / channels as f32));
    }
    if mono.is_empty() {
        return Err("no audio samples decoded".into());
    }
    if sample_rate == SR {
        return Ok(mono);
    }

    use rubato::audioadapter_buffers::direct::InterleavedSlice;
    use rubato::{Fft, FixedSync, Resampler};
    let mut r = Fft::<f32>::new(sample_rate as usize, SR as usize, 1024, 1, FixedSync::Both)
        .map_err(|e| e.to_string())?;
    let input = InterleavedSlice::new(&mono, 1, mono.len()).map_err(|e| e.to_string())?;
    let out = r.process_all(&input, mono.len(), None).map_err(|e| e.to_string())?;
    Ok(out.take_data())
}

// ---------------------------------------------------------------------------
// 特徴量
// ---------------------------------------------------------------------------

/// 16kHz モノラルの音声から特徴量を出す。
pub fn extract(y: &[f32]) -> Result<Features, String> {
    let models = Models::get()?;
    let mut values: Vec<(String, f32)> = Vec::new();

    // --- (a) メルスペクトログラム (Essentia の TensorflowInputMusiCNN 相当) と信号特徴 ---
    const N_FFT: usize = 512;
    const HOP: usize = 256;
    let fb = dsp::mel_filterbank(SR, N_FFT, 96, 0.0, 8000.0);
    let freqs: Vec<f32> = (0..=N_FFT / 2).map(|k| k as f32 * SR as f32 / N_FFT as f32).collect();
    let mut mel: Vec<[f32; 96]> = Vec::new();
    let (mut rms_db, mut centroid, mut flatness) = (Vec::new(), Vec::new(), Vec::new());
    let (mut bass, mut total) = (0f64, 0f64);
    // onset 包絡 (メル dB の正の差分の平均) 用に 1 つ前のフレームを持つ
    let mut prev_db: Option<[f32; 96]> = None;
    let mut env: Vec<f32> = Vec::new();
    dsp::for_each_power_frame(y, N_FFT, HOP, &dsp::hann(N_FFT, false), true, |p| {
        let mut m = [0f32; 96];
        let mut db = [0f32; 96];
        for (b, w) in fb.iter().enumerate() {
            let e: f32 = w.iter().zip(p).map(|(a, b)| a * b).sum();
            m[b] = (1.0 + 10000.0 * e).log10();
            db[b] = 10.0 * e.max(1e-10).log10();
        }
        mel.push(m);
        env.push(prev_db.map_or(0.0, |q| db.iter().zip(&q).map(|(a, b)| (a - b).max(0.0)).sum::<f32>() / 96.0));
        prev_db = Some(db);

        let sum: f32 = p.iter().sum();
        rms_db.push(10.0 * (2.0 * sum / (N_FFT * N_FFT) as f32 + 1e-18).log10());
        let mag: Vec<f32> = p.iter().map(|x| x.sqrt()).collect();
        let ms: f32 = mag.iter().sum();
        centroid.push(if ms > 0.0 { mag.iter().zip(&freqs).map(|(a, f)| a * f).sum::<f32>() / ms } else { 0.0 });
        let geo = (p.iter().map(|x| x.max(1e-10).ln()).sum::<f32>() / p.len() as f32).exp();
        flatness.push(geo / (sum / p.len() as f32).max(1e-10));
        for (x, f) in p.iter().zip(&freqs) {
            if *f < 250.0 {
                bass += *x as f64;
            }
            total += *x as f64;
        }
    });
    if mel.len() < 2 {
        return Err("audio too short".into());
    }

    let max_db = rms_db.iter().cloned().fold(f32::NEG_INFINITY, f32::max);
    let loud: Vec<usize> = (0..rms_db.len()).filter(|&i| rms_db[i] > max_db - 40.0).collect();
    let pick = |v: &[f32]| loud.iter().map(|&i| v[i]).collect::<Vec<f32>>();
    let fps = SR as f32 / HOP as f32;
    let loud_db = pick(&rms_db);
    let env_mean = mean(&env);
    let c: Vec<f32> = env.iter().map(|x| x - env_mean).collect();
    let ac0: f32 = c.iter().map(|x| x * x).sum::<f32>() + 1e-9;
    let pulse_clarity = ((0.25 * fps) as usize..((2.0 * fps) as usize).min(c.len()))
        .map(|lag| c[..c.len() - lag].iter().zip(&c[lag..]).map(|(a, b)| a * b).sum::<f32>() / ac0)
        .fold(0f32, f32::max);
    let block = (3.0 * fps) as usize;
    let section_db: Vec<f32> = rms_db
        .chunks_exact(block)
        .map(|ch| 10.0 * mean(&ch.iter().map(|d| 10f32.powf(d / 10.0)).collect::<Vec<_>>()).max(1e-18).log10())
        .collect();
    values.extend([
        ("onset_strength", percentile(&env, 50.0)),
        ("rms_dynamic", percentile(&loud_db, 95.0) - percentile(&loud_db, 10.0)),
        ("centroid", percentile(&pick(&centroid), 50.0)),
        ("flatness", percentile(&pick(&flatness), 50.0)),
        ("pulse_clarity", pulse_clarity),
        ("accent_contrast", std(&env) / (env_mean + 1e-9)),
        ("bass_ratio", (bass / total.max(1e-18)) as f32),
        ("section_var", std(&section_db)),
    ].map(|(n, v)| (n.to_string(), v)));

    // --- (b) effnet: 128 フレームのパッチ (hop 62) から等間隔に N_PATCHES 個 ---
    let n_frames = mel.len().max(128);
    let n_patch = 1 + (n_frames - 128) / 62;
    let mut patches = Vec::with_capacity(N_PATCHES * 128 * 96);
    for i in 0..N_PATCHES {
        let start = 62 * (i * (n_patch - 1) / (N_PATCHES - 1));
        for t in start..start + 128 {
            patches.extend_from_slice(mel.get(t).unwrap_or(&[0f32; 96]));
        }
    }
    drop(mel);
    let emb = models.embed(patches).map_err(|e| e.to_string())?;
    values.extend(models.head_features(&emb).map_err(|e| e.to_string())?);
    let embedding = emb.mean_axis(tract_onnx::prelude::tract_ndarray::Axis(0)).expect("non-empty batch").to_vec();

    // --- (c) 和声 ---
    values.extend(harmony(y, &env).into_iter().map(|(n, v)| (n.to_string(), v)));
    Ok(Features { values, embedding })
}

// Krumhansl-Kessler の調性プロファイル (C から)
const MAJOR: [f32; 12] = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR: [f32; 12] = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

/// 和声の特徴: ドラム成分を除いたスペクトルから半音帯ごとのクロマを作り、ビート区間ごとに
/// 長三和音 / 短三和音を判定する。曲全体と、盛り上がり区間 (音量上位 30%) の 2 通りで集計する。
/// `onset_env` はメルの onset 包絡 (hop 256)。
fn harmony(y: &[f32], onset_env: &[f32]) -> Vec<(&'static str, f32)> {
    const N_FFT: usize = 4096;
    const HOP: usize = 512;
    const LO_MIDI: i32 = 33; // A1 (55Hz)
    const HI_MIDI: i32 = 95; // B6 (約 1976Hz)
    let bin_hz = SR as f32 / N_FFT as f32;
    let n_bins = ((440.0 * 2f32.powf((HI_MIDI as f32 + 0.5 - 69.0) / 12.0)) / bin_hz) as usize + 2;

    // スペクトル振幅 (必要な低域ビンだけ) と、フレーム全体のパワー
    let mut s: Vec<Vec<f32>> = Vec::new();
    let mut frame_power: Vec<f32> = Vec::new();
    dsp::for_each_power_frame(y, N_FFT, HOP, &dsp::hann(N_FFT, true), false, |p| {
        s.push(p[..n_bins].iter().map(|x| x.sqrt()).collect());
        frame_power.push(p.iter().sum());
    });
    let n = s.len();
    if n < 2 {
        return HARMONY_NAMES.iter().map(|n| (*n, 0.0)).collect();
    }

    // ビート区間の境界 (このスペクトルのフレーム番号)。onset 包絡は hop 256 で中心揃え、
    // こちらは hop 512 で窓の先頭揃えなので、2 フレームずつ最大値でまとめてから窓半分 (4 フレーム) ずらす。
    let env512: Vec<f32> = onset_env.chunks(2).map(|c| c.iter().cloned().fold(0f32, f32::max)).collect();
    let mut bounds: Vec<usize> = dsp::beat_track(&env512, SR as f32 / HOP as f32)
        .into_iter()
        .filter_map(|b| b.checked_sub(N_FFT / 2 / HOP))
        .filter(|&b| b < n)
        .collect();
    bounds.insert(0, 0);
    bounds.push(n);
    bounds.dedup();

    // HPSS 相当のマスク: 時間方向の中央値 (和音) が周波数方向の中央値 (打楽器) の 2 倍を超えるビンだけ残す
    let perc: Vec<Vec<f32>> = s.iter().map(|f| dsp::median_filter(f, 31)).collect();
    let midi_of = |k: usize| (69.0 + 12.0 * (k as f32 * bin_hz / 440.0).log2()).round() as i32;
    let band_size: Vec<f32> = (LO_MIDI..=HI_MIDI)
        .map(|m| (1..n_bins).filter(|&k| midi_of(k) == m).count().max(1) as f32)
        .collect();
    let n_seg = bounds.len() - 1;
    let seg_of: Vec<usize> = {
        let mut v = vec![0; n];
        for (si, w) in bounds.windows(2).enumerate() {
            v[w[0]..w[1]].iter_mut().for_each(|x| *x = si);
        }
        v
    };
    // 区間 x 半音帯 のパワー和
    let mut band = vec![vec![0f32; (HI_MIDI - LO_MIDI + 1) as usize]; n_seg];
    for k in 1..n_bins {
        let m = midi_of(k);
        if !(LO_MIDI..=HI_MIDI).contains(&m) {
            continue;
        }
        let col: Vec<f32> = s.iter().map(|f| f[k]).collect();
        let harm = dsp::median_filter(&col, 31);
        for t in 0..n {
            if harm[t] > 2.0 * perc[t][k] {
                band[seg_of[t]][(m - LO_MIDI) as usize] += s[t][k] * s[t][k];
            }
        }
    }
    // 半音帯ごとに平均して振幅に戻し、12 音名に畳む
    let chroma: Vec<[f32; 12]> = band
        .iter()
        .map(|b| {
            let mut c = [0f32; 12];
            for (i, e) in b.iter().enumerate() {
                c[(i as i32 + LO_MIDI) as usize % 12] += (e / band_size[i]).sqrt();
            }
            c
        })
        .collect();
    let rms: Vec<f32> = bounds.windows(2).map(|w| frame_power[w[0]..w[1]].iter().sum::<f32>().sqrt()).collect();
    harmony_features(&chroma, &rms)
}

const HARMONY_NAMES: [&str; 14] = [
    "h_key_mm", "h_key_is_major", "h_tonic_minor", "h_minor_chord_ratio", "h_minor_margin", "h_chord_fit",
    "h_loud_key_mm", "h_loud_key_is_major", "h_loud_tonic_minor", "h_loud_minor_chord_ratio",
    "h_loud_minor_margin", "h_loud_chord_fit", "h_chord_change", "h_chroma_entropy",
];

fn harmony_features(chroma: &[[f32; 12]], rms: &[f32]) -> Vec<(&'static str, f32)> {
    // 三和音テンプレート: 添字 0..12 が長三和音 (根音 C..B)、12..24 が短三和音
    let templ: Vec<[f32; 12]> = [[0, 4, 7], [0, 3, 7]]
        .iter()
        .flat_map(|iv| {
            (0..12).map(move |root| {
                let mut t = [0f32; 12];
                iv.iter().for_each(|i| t[(root + i) % 12] = 1.0 / 3f32.sqrt());
                t
            })
        })
        .collect();
    let energy: Vec<f32> = chroma.iter().map(|c| c.iter().sum()).collect();
    let mut best = Vec::new();
    let mut fit = Vec::new();
    let mut margin = Vec::new();
    for c in chroma {
        let norm = c.iter().map(|x| x * x).sum::<f32>().sqrt() + 1e-9;
        let sim: Vec<f32> = templ.iter().map(|t| t.iter().zip(c).map(|(a, b)| a * b).sum::<f32>() / norm).collect();
        let b = (0..24).max_by(|&i, &j| sim[i].total_cmp(&sim[j])).expect("24 templates");
        let max_of = |r: std::ops::Range<usize>| sim[r].iter().cloned().fold(f32::NEG_INFINITY, f32::max);
        best.push(b);
        fit.push(sim[b]);
        margin.push(max_of(12..24) - max_of(0..12));
    }
    let voiced_th = percentile(&energy, 20.0);
    let loud_th = percentile(rms, 70.0);
    let voiced: Vec<bool> = energy.iter().map(|e| *e > voiced_th).collect();
    let loud: Vec<bool> = rms.iter().map(|r| *r >= loud_th).collect();

    let mut out = Vec::new();
    for mask in [voiced.clone(), voiced.iter().zip(&loud).map(|(a, b)| *a && *b).collect::<Vec<bool>>()] {
        let idx: Vec<usize> = (0..chroma.len()).filter(|&i| mask[i]).collect();
        let mut cm = [0f32; 12];
        for &i in &idx {
            (0..12).for_each(|p| cm[p] += chroma[i][p] / idx.len().max(1) as f32);
        }
        // 24 調との相関。np.roll(profile, k) は音名 p に profile[(p - k) mod 12] を当てる
        let key_corr = |prof: &[f32; 12]| -> Vec<f32> {
            (0..12).map(|k| dsp::corr(&(0..12).map(|p| prof[(p + 12 - k) % 12]).collect::<Vec<_>>(), &cm)).collect()
        };
        let (maj, mnr) = (key_corr(&MAJOR), key_corr(&MINOR));
        let argmax = |v: &[f32]| (0..12).max_by(|&i, &j| v[i].total_cmp(&v[j])).expect("12 keys");
        let (mj, mn) = (maj[argmax(&maj)], mnr[argmax(&mnr)]);
        let tonic = if mj >= mn { argmax(&maj) } else { argmax(&mnr) };
        let on_tonic: Vec<bool> = idx.iter().filter(|&&i| best[i] % 12 == tonic).map(|&i| best[i] >= 12).collect();
        let tonic_minor = if on_tonic.is_empty() {
            0.5
        } else {
            on_tonic.iter().filter(|m| **m).count() as f32 / on_tonic.len() as f32
        };
        let pick = |v: &[f32]| idx.iter().map(|&i| v[i]).collect::<Vec<f32>>();
        let m = pick(&margin);
        out.extend([
            mj - mn,
            if mj >= mn { 1.0 } else { 0.0 },
            tonic_minor,
            m.iter().filter(|x| **x > 0.0).count() as f32 / m.len().max(1) as f32,
            mean(&m),
            mean(&pick(&fit)),
        ]);
    }
    let vb: Vec<usize> = (0..chroma.len()).filter(|&i| voiced[i]).map(|i| best[i]).collect();
    out.push(if vb.len() > 1 {
        vb.windows(2).filter(|w| w[0] != w[1]).count() as f32 / (vb.len() - 1) as f32
    } else {
        0.0
    });
    out.push(mean(
        &chroma
            .iter()
            .map(|c| {
                let s: f32 = c.iter().sum::<f32>() + 1e-9;
                -c.iter().map(|x| x / s * (x / s + 1e-9).ln()).sum::<f32>()
            })
            .collect::<Vec<_>>(),
    ));
    HARMONY_NAMES.iter().cloned().zip(out).collect()
}
