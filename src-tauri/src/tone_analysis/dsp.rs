//! 曲調推定の特徴量計算に使う信号処理。
//! 学習 (tools/tone-model/train.py) はこのモジュールで出した値をそのまま使うので、
//! ここを変えたら tone_dump で特徴量を出し直して重みを作り直すこと。

use realfft::RealFftPlanner;

pub const SR: u32 = 16000;

/// Hann 窓。`periodic` が false なら対称窓 (numpy.hanning / scipy の sym=True 相当)。
pub fn hann(n: usize, periodic: bool) -> Vec<f32> {
    let m = if periodic { n } else { n - 1 } as f32;
    (0..n)
        .map(|i| 0.5 - 0.5 * (2.0 * std::f32::consts::PI * i as f32 / m).cos())
        .collect()
}

/// パワースペクトログラムをフレームごとに計算してコールバックに渡す。
/// `center` が true なら両端を n_fft/2 のゼロで埋める (librosa の center=True, pad_mode="constant")。
pub fn for_each_power_frame(
    y: &[f32],
    n_fft: usize,
    hop: usize,
    window: &[f32],
    center: bool,
    mut f: impl FnMut(&[f32]),
) {
    let pad = if center { n_fft / 2 } else { 0 };
    let total = y.len() + 2 * pad;
    if total < n_fft {
        return;
    }
    let n_frames = 1 + (total - n_fft) / hop;
    let mut planner = RealFftPlanner::<f32>::new();
    let fft = planner.plan_fft_forward(n_fft);
    let mut input = fft.make_input_vec();
    let mut spectrum = fft.make_output_vec();
    let mut power = vec![0f32; n_fft / 2 + 1];
    for t in 0..n_frames {
        let start = (t * hop) as isize - pad as isize;
        for (i, v) in input.iter_mut().enumerate() {
            let k = start + i as isize;
            let s = if k >= 0 && (k as usize) < y.len() { y[k as usize] } else { 0.0 };
            *v = s * window[i];
        }
        fft.process(&mut input, &mut spectrum).expect("fft length is fixed");
        for (p, c) in power.iter_mut().zip(&spectrum) {
            *p = c.norm_sqr();
        }
        f(&power);
    }
}

/// Slaney 方式のメルフィルタバンク (librosa.filters.mel の htk=False, norm="slaney")。
/// 戻り値は [バンド][ビン]。
pub fn mel_filterbank(sr: u32, n_fft: usize, n_mels: usize, fmin: f32, fmax: f32) -> Vec<Vec<f32>> {
    fn hz_to_mel(f: f32) -> f32 {
        let (f_sp, min_log_hz) = (200.0 / 3.0, 1000.0);
        let logstep = (6.4f32).ln() / 27.0;
        if f >= min_log_hz {
            min_log_hz / f_sp + (f / min_log_hz).ln() / logstep
        } else {
            f / f_sp
        }
    }
    fn mel_to_hz(m: f32) -> f32 {
        let (f_sp, min_log_hz) = (200.0 / 3.0, 1000.0);
        let min_log_mel = min_log_hz / f_sp;
        let logstep = (6.4f32).ln() / 27.0;
        if m >= min_log_mel {
            min_log_hz * (logstep * (m - min_log_mel)).exp()
        } else {
            f_sp * m
        }
    }
    let n_bins = n_fft / 2 + 1;
    let fft_freqs: Vec<f32> = (0..n_bins).map(|k| k as f32 * sr as f32 / n_fft as f32).collect();
    let (lo, hi) = (hz_to_mel(fmin), hz_to_mel(fmax));
    let pts: Vec<f32> = (0..n_mels + 2)
        .map(|i| mel_to_hz(lo + (hi - lo) * i as f32 / (n_mels + 1) as f32))
        .collect();
    (0..n_mels)
        .map(|m| {
            let enorm = 2.0 / (pts[m + 2] - pts[m]);
            fft_freqs
                .iter()
                .map(|&f| {
                    let lower = (f - pts[m]) / (pts[m + 1] - pts[m]);
                    let upper = (pts[m + 2] - f) / (pts[m + 2] - pts[m + 1]);
                    lower.min(upper).max(0.0) * enorm
                })
                .collect()
        })
        .collect()
}

/// numpy.percentile (linear 補間) 相当。`q` は 0〜100。空なら 0。
pub fn percentile(v: &[f32], q: f32) -> f32 {
    if v.is_empty() {
        return 0.0;
    }
    let mut s = v.to_vec();
    s.sort_by(|a, b| a.total_cmp(b));
    let pos = q / 100.0 * (s.len() - 1) as f32;
    let (i, frac) = (pos.floor() as usize, pos - pos.floor());
    if i + 1 < s.len() {
        s[i] + (s[i + 1] - s[i]) * frac
    } else {
        s[i]
    }
}

pub fn mean(v: &[f32]) -> f32 {
    if v.is_empty() {
        0.0
    } else {
        v.iter().sum::<f32>() / v.len() as f32
    }
}

pub fn std(v: &[f32]) -> f32 {
    let m = mean(v);
    mean(&v.iter().map(|x| (x - m) * (x - m)).collect::<Vec<_>>()).sqrt()
}

/// 長さ `k` (奇数) の移動中央値。端は端の値で埋める (scipy.ndimage.median_filter の mode="nearest")。
pub fn median_filter(v: &[f32], k: usize) -> Vec<f32> {
    let h = k / 2;
    let n = v.len() as isize;
    let mut win = vec![0f32; k];
    (0..v.len())
        .map(|i| {
            for (j, w) in win.iter_mut().enumerate() {
                let idx = (i as isize + j as isize - h as isize).clamp(0, n - 1);
                *w = v[idx as usize];
            }
            let (_, m, _) = win.select_nth_unstable_by(h, |a, b| a.total_cmp(b));
            *m
        })
        .collect()
}

/// ピアソン相関係数。
pub fn corr(a: &[f32], b: &[f32]) -> f32 {
    let (ma, mb) = (mean(a), mean(b));
    let (mut num, mut da, mut db) = (0f32, 0f32, 0f32);
    for (x, y) in a.iter().zip(b) {
        num += (x - ma) * (y - mb);
        da += (x - ma) * (x - ma);
        db += (y - mb) * (y - mb);
    }
    num / (da.sqrt() * db.sqrt() + 1e-12)
}

/// ビート位置 (onset 包絡のフレーム番号) を推定する。librosa.beat.beat_track の簡易版:
/// 自己相関とテンポ事前分布 (120 BPM 中心の対数正規) で周期を決め、動的計画法でビート列を選ぶ。
pub fn beat_track(env: &[f32], fps: f32) -> Vec<usize> {
    let n = env.len();
    if n < 4 {
        return Vec::new();
    }
    let sd = std(env);
    if sd <= 0.0 {
        return Vec::new();
    }
    // --- テンポ: 約 8 秒までの自己相関に事前分布を掛けて最大の周期を選ぶ ---
    let max_lag = ((8.0 * fps) as usize).min(n - 1);
    let m = mean(env);
    let c: Vec<f32> = env.iter().map(|x| x - m).collect();
    let mut best = (f32::NEG_INFINITY, 0usize);
    for lag in 1..=max_lag {
        let bpm = 60.0 * fps / lag as f32;
        if bpm > 320.0 {
            continue;
        }
        let ac: f32 = c[..n - lag].iter().zip(&c[lag..]).map(|(a, b)| a * b).sum::<f32>() / n as f32;
        let prior = -0.5 * ((bpm.log2() - 120f32.log2()) / 1.0).powi(2);
        let score = (1.0 + 1e6 * ac.max(0.0) / (sd * sd)).ln() + prior;
        if score > best.0 {
            best = (score, lag);
        }
    }
    let period = best.1.max(1) as f32;

    // --- 局所スコア: 正規化した包絡をガウス窓で平滑化 ---
    let p = period.round() as isize;
    let win: Vec<f32> = (-p..=p)
        .map(|i| (-0.5 * (i as f32 * 32.0 / period).powi(2)).exp())
        .collect();
    let norm: Vec<f32> = env.iter().map(|x| x / sd).collect();
    let local: Vec<f32> = (0..n as isize)
        .map(|i| {
            win.iter()
                .enumerate()
                .map(|(j, w)| {
                    let k = i + j as isize - p;
                    if k >= 0 && (k as usize) < n { norm[k as usize] * w } else { 0.0 }
                })
                .sum()
        })
        .collect();

    // --- 動的計画法: 直前のビートとの間隔が周期に近いほど高得点 ---
    const TIGHTNESS: f32 = 100.0;
    let (lo, hi) = ((period / 2.0).round() as usize, (2.0 * period).round() as usize);
    let mut cum = vec![0f32; n];
    let mut back = vec![usize::MAX; n];
    for i in 0..n {
        let mut best_prev = (0f32, usize::MAX);
        if i >= lo {
            let first = i.saturating_sub(hi);
            for j in first..=i - lo {
                let gap = (i - j) as f32;
                let s = cum[j] - TIGHTNESS * (gap / period).ln().powi(2);
                if best_prev.1 == usize::MAX || s > best_prev.0 {
                    best_prev = (s, j);
                }
            }
        }
        if best_prev.1 != usize::MAX && best_prev.0 > 0.0 {
            cum[i] = local[i] + best_prev.0;
            back[i] = best_prev.1;
        } else {
            cum[i] = local[i];
        }
    }

    // 最後のビート: 末尾 1 周期のうち累積スコア最大のフレーム
    let tail_start = n.saturating_sub(period as usize + 1);
    let mut i = (tail_start..n).max_by(|&a, &b| cum[a].total_cmp(&cum[b])).unwrap_or(n - 1);
    let mut beats = vec![i];
    while back[i] != usize::MAX {
        i = back[i];
        beats.push(i);
    }
    beats.reverse();

    // 両端の弱いビート (局所スコアが RMS の半分未満) を落とす
    let rms = (beats.iter().map(|&b| local[b] * local[b]).sum::<f32>() / beats.len() as f32).sqrt();
    let keep = |b: &usize| local[*b] >= 0.5 * rms;
    let first = beats.iter().position(keep).unwrap_or(0);
    let last = beats.iter().rposition(keep).unwrap_or(beats.len() - 1);
    beats[first..=last].to_vec()
}
