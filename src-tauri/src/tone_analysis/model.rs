//! Essentia の ONNX モデル (CC BY-NC-SA 4.0, models/README.md 参照) と、学習済みの線形モデルの重み。

use std::io::Cursor;
use std::sync::OnceLock;
use tract_onnx::prelude::*;

/// effnet に入れるパッチ数。曲全体から等間隔に選ぶ (全パッチ平均と精度は変わらない)。
pub const N_PATCHES: usize = 16;

type Plan = SimplePlan<TypedFact, Box<dyn TypedOp>, Graph<TypedFact, Box<dyn TypedOp>>>;

/// effnet 埋め込みの上に載る分類ヘッド。`columns` が None なら全出力を使う。
struct Head {
    prefix: &'static str,
    names: &'static [&'static str],
    columns: Option<usize>,
    plan: Plan,
}

pub struct Models {
    effnet: Plan,
    heads: Vec<Head>,
}

const INSTRUMENTS: &[&str] = &[
    "accordion", "acousticbassguitar", "acousticguitar", "bass", "beat", "bell", "bongo", "brass",
    "cello", "clarinet", "classicalguitar", "computer", "doublebass", "drummachine", "drums",
    "electricguitar", "electricpiano", "flute", "guitar", "harmonica", "harp", "horn", "keyboard",
    "oboe", "orchestra", "organ", "pad", "percussion", "piano", "pipeorgan", "rhodes", "sampler",
    "saxophone", "strings", "synthesizer", "trombone", "trumpet", "viola", "violin", "voice",
];
const MOODTHEMES: &[&str] = &[
    "action", "adventure", "advertising", "background", "ballad", "calm", "children", "christmas",
    "commercial", "cool", "corporate", "dark", "deep", "documentary", "drama", "dramatic", "dream",
    "emotional", "energetic", "epic", "fast", "film", "fun", "funny", "game", "groovy", "happy",
    "heavy", "holiday", "hopeful", "inspiring", "love", "meditative", "melancholic", "melodic",
    "motivational", "movie", "nature", "party", "positive", "powerful", "relaxing", "retro",
    "romantic", "sad", "sexy", "slow", "soft", "soundscape", "space", "sport", "summer", "trailer",
    "travel", "upbeat", "uplifting",
];

macro_rules! onnx {
    ($name:literal) => {
        include_bytes!(concat!("../../models/", $name, ".onnx")).as_slice()
    };
}

/// ONNX を読み込み、入力の可変次元 (バッチ) を `batch` に固定して最適化する。
/// tract は可変次元のままだと畳み込みの最適化が効かず数倍遅くなる。
fn load(bytes: &[u8], batch: usize) -> TractResult<Plan> {
    let model = tract_onnx::onnx()
        .model_for_read(&mut Cursor::new(bytes))?
        .into_typed()?;
    let mut values = SymbolValues::default();
    for d in model.input_fact(0)?.shape.iter() {
        if let TDim::Sym(s) = d {
            values = values.with(s, batch as i64);
        }
    }
    model.concretize_dims(&values)?.into_optimized()?.into_runnable()
}

impl Models {
    fn new() -> TractResult<Self> {
        let n = N_PATCHES;
        let head = |prefix, names, columns, bytes| -> TractResult<Head> {
            Ok(Head { prefix, names, columns, plan: load(bytes, n)? })
        };
        Ok(Self {
            effnet: load(onnx!("discogs-effnet-bsdynamic-1"), n)?,
            heads: vec![
                head("inst_", INSTRUMENTS, None, onnx!("mtg_jamendo_instrument-discogs-effnet-1"))?,
                head("mt_", MOODTHEMES, None, onnx!("mtg_jamendo_moodtheme-discogs-effnet-1"))?,
                head("", &["acoustic"], Some(0), onnx!("mood_acoustic-discogs-effnet-1"))?,
                head("", &["electronic"], Some(0), onnx!("mood_electronic-discogs-effnet-1"))?,
                head("", &["happy"], Some(0), onnx!("mood_happy-discogs-effnet-1"))?,
                head("", &["sad"], Some(1), onnx!("mood_sad-discogs-effnet-1"))?,
                head("", &["engagement"], Some(0), onnx!("engagement_regression-discogs-effnet-1"))?,
                head("", &["approachability"], Some(0), onnx!("approachability_regression-discogs-effnet-1"))?,
                head("", &["bright"], Some(0), onnx!("timbre-discogs-effnet-1"))?,
                head("", &["tonal"], Some(1), onnx!("tonal_atonal-discogs-effnet-1"))?,
                head("", &["aggressive"], Some(0), onnx!("mood_aggressive-discogs-effnet-1"))?,
                head("", &["relaxed"], Some(1), onnx!("mood_relaxed-discogs-effnet-1"))?,
                head("", &["danceable"], Some(0), onnx!("danceability-discogs-effnet-1"))?,
            ],
        })
    }

    /// 読み込みは重い (数百 ms) ので 1 度だけ行い、全スレッドで共有する。
    pub fn get() -> Result<&'static Models, String> {
        static MODELS: OnceLock<Result<Models, String>> = OnceLock::new();
        MODELS
            .get_or_init(|| Models::new().map_err(|e| format!("failed to load tone models: {e}")))
            .as_ref()
            .map_err(|e| e.clone())
    }

    /// パッチ [N_PATCHES, 128, 96] → 埋め込み [N_PATCHES, 1280]
    pub fn embed(&self, patches: Vec<f32>) -> TractResult<tract_ndarray::Array2<f32>> {
        let x = tract_ndarray::Array3::from_shape_vec((N_PATCHES, 128, 96), patches)?;
        let out = self.effnet.run(tvec!(Tensor::from(x).into()))?;
        // 出力 0 は Discogs スタイルの活性化、1 が埋め込み
        Ok(out[1].to_array_view::<f32>()?.into_dimensionality()?.to_owned())
    }

    /// 各ヘッドの出力をパッチ平均して (特徴名, 値) を返す。
    pub fn head_features(&self, emb: &tract_ndarray::Array2<f32>) -> TractResult<Vec<(String, f32)>> {
        let input: TValue = Tensor::from(emb.clone()).into();
        let mut out = Vec::new();
        for h in &self.heads {
            let res = h.plan.run(tvec!(input.clone()))?;
            let mean = res[0].to_array_view::<f32>()?.mean_axis(tract_ndarray::Axis(0)).expect("non-empty batch");
            match h.columns {
                None => out.extend(h.names.iter().zip(mean.iter()).map(|(n, v)| (format!("{}{n}", h.prefix), *v))),
                Some(c) => out.push((h.names[0].to_string(), mean[c])),
            }
        }
        Ok(out)
    }
}

// ---------------------------------------------------------------------------
// 学習済みの線形モデル (tools/tone-model/train.py が models/tone_weights.json に書き出す)
// ---------------------------------------------------------------------------

#[derive(serde::Deserialize)]
struct Standardize {
    names: Vec<String>,
    mean: Vec<f32>,
    std: Vec<f32>,
}

#[derive(serde::Deserialize)]
struct EnergyWeights {
    features: Standardize,
    /// 多クラスロジスティック回帰 (クラス 0/1/2)。[クラス][特徴]
    logit_coef: Vec<Vec<f32>>,
    logit_intercept: Vec<f32>,
    emb_mean: Vec<f32>,
    emb_std: Vec<f32>,
    pca_mean: Vec<f32>,
    /// [主成分][1280]
    pca_components: Vec<Vec<f32>>,
    ridge_coef: Vec<f32>,
    ridge_intercept: f32,
}

#[derive(serde::Deserialize)]
struct MoodWeights {
    features: Standardize,
    clip: f32,
    coef: Vec<f32>,
    intercept: f32,
}

#[derive(serde::Deserialize)]
pub struct Weights {
    lufs_median: f32,
    energy: EnergyWeights,
    mood: MoodWeights,
}

impl Weights {
    pub fn get() -> Result<&'static Weights, String> {
        static W: OnceLock<Result<Weights, String>> = OnceLock::new();
        W.get_or_init(|| {
            serde_json::from_str(include_str!("../../models/tone_weights.json"))
                .map_err(|e| format!("invalid tone_weights.json: {e}"))
        })
        .as_ref()
        .map_err(|e| e.clone())
    }
}

fn standardized(s: &Standardize, value: &dyn Fn(&str) -> Option<f32>) -> Result<Vec<f32>, String> {
    s.names
        .iter()
        .zip(s.mean.iter().zip(&s.std))
        .map(|(n, (m, sd))| value(n).map(|v| (v - m) / sd).ok_or_else(|| format!("missing feature {n}")))
        .collect()
}

fn dot(a: &[f32], b: &[f32]) -> f32 {
    a.iter().zip(b).map(|(x, y)| x * y).sum()
}

impl Weights {
    /// エネルギーのスコア (0〜2, 境界 0.5 / 1.5)。
    /// 特徴量のロジスティック回帰の期待値と、埋め込みのリッジ回帰の平均。
    pub fn energy_score(&self, value: &dyn Fn(&str) -> Option<f32>, lufs: Option<f32>, emb: &[f32]) -> Result<f32, String> {
        let w = &self.energy;
        let lufs = lufs.unwrap_or(self.lufs_median);
        let z = standardized(&w.features, &|n| if n == "lufs" { Some(lufs) } else { value(n) })?;
        let logits: Vec<f32> = w.logit_coef.iter().zip(&w.logit_intercept).map(|(c, b)| dot(c, &z) + b).collect();
        let max = logits.iter().cloned().fold(f32::NEG_INFINITY, f32::max);
        let exp: Vec<f32> = logits.iter().map(|l| (l - max).exp()).collect();
        let sum: f32 = exp.iter().sum();
        let by_logit: f32 = exp.iter().enumerate().map(|(k, e)| k as f32 * e / sum).sum();

        let ze: Vec<f32> = emb
            .iter()
            .zip(w.emb_mean.iter().zip(&w.emb_std))
            .zip(&w.pca_mean)
            .map(|((x, (m, sd)), pm)| (x - m) / sd - pm)
            .collect();
        let pcs: Vec<f32> = w.pca_components.iter().map(|c| dot(c, &ze)).collect();
        let by_emb = dot(&w.ridge_coef, &pcs) + w.ridge_intercept;
        Ok((by_logit + by_emb) / 2.0)
    }

    /// 明暗のスコア (0.5 より大きければ明)。
    pub fn mood_score(&self, value: &dyn Fn(&str) -> Option<f32>) -> Result<f32, String> {
        let w = &self.mood;
        let z: Vec<f32> = standardized(&w.features, value)?.into_iter().map(|v| v.clamp(-w.clip, w.clip)).collect();
        Ok(dot(&w.coef, &z) + w.intercept)
    }
}
