//! 音声の解析。DB や Tauri には触らず、開いたファイルを受け取って結果を返す。

pub mod loudness;
pub mod tone;

use crate::error::Result;
use std::fs::File;
use symphonia::core::codecs::{Decoder, DecoderOptions};
use symphonia::core::formats::{FormatOptions, FormatReader};
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;

/// ファイルのフォーマットを判定し、既定のトラックのデコーダを作る。`ext` は判定のヒント (拡張子)。
fn open_track(file: File, ext: &str) -> Result<(Box<dyn FormatReader>, Box<dyn Decoder>, u32)> {
    let mut hint = Hint::new();
    if !ext.is_empty() {
        hint.with_extension(ext);
    }
    let mss = MediaSourceStream::new(Box::new(file), Default::default());
    let probed = symphonia::default::get_probe().format(&hint, mss, &FormatOptions::default(), &MetadataOptions::default())?;
    let format = probed.format;
    let track = format.default_track().ok_or("No track found")?;
    let decoder = symphonia::default::get_codecs().make(&track.codec_params, &DecoderOptions::default())?;
    let track_id = track.id;
    Ok((format, decoder, track_id))
}
