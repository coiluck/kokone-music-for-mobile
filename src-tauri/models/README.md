# 曲調タグのモデル

`src/tone_analysis/` がビルド時に `include_bytes!` / `include_str!` で埋め込むファイル。

## Essentia のモデル (`*.onnx`)

[Essentia models](https://essentia.upf.edu/models.html) (Music Technology Group, Universitat Pompeu Fabra) の ONNX 版。
ライセンスは [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/) で、非商用に限り利用できる。

| ファイル | 用途 |
| --- | --- |
| `discogs-effnet-bsdynamic-1.onnx` | メルスペクトログラム → 1280 次元の埋め込み |
| `mtg_jamendo_instrument-discogs-effnet-1.onnx` | 楽器 (40 クラス) |
| `mtg_jamendo_moodtheme-discogs-effnet-1.onnx` | ムード・テーマ (56 クラス) |
| `mood_*-discogs-effnet-1.onnx` | acoustic / electronic / happy / sad / aggressive / relaxed |
| `danceability-`, `engagement_regression-`, `approachability_regression-`, `timbre-`, `tonal_atonal-discogs-effnet-1.onnx` | 各 1 次元の指標 |

## 学習済みの重み (`tone_weights.json`)

上のモデルの出力などを特徴量にした線形モデルの重み。`tools/tone-model/train.py` が作る。
Essentia のモデルの出力から作ったものなので、同じく CC BY-NC-SA 4.0 とする。
