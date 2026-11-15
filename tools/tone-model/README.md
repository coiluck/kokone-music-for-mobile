# 曲調モデルの重みの作り直し

スキャン後、曲調タグ (エネルギー 低/中/高・明暗 暗/淡/明) が付いていない曲に推定タグが付く。
タグ名は `src-tauri/src/analysis/tone/mod.rs` の `ENERGY_TAGS` / `MOOD_TAGS`。
推定に使う重み `src-tauri/models/tone_weights.json` は、手で付けたラベルから次の手順で作る。

1. 特徴量を書き出す (アプリと同じ Rust の処理を使う)

   ```bash
   cd src-tauri
   cargo run --release --example tone_dump -- <曲フォルダ> tone_dump.jsonl
   ```

2. ラベルを用意する。どちらも `[{"id": "<曲フォルダからの相対パス>", "level": "..."}]` 形式。
   `labels/` に置くと `.gitignore` でリポジトリから除外される (曲名の一覧になるので公開しない)。
   今の重みを作ったラベルは作者の手元にだけある (id は Android の Download/Music からの相対パス)。
   - `energy_labels.json`: level は `低` / `中` / `高`
   - `mood3_labels.json`: level は `暗` / `淡` / `明`

   明暗のラベルは `python tools/tone-model/label.py <曲フォルダ>` を起動し、ブラウザで曲を聴きながらボタンを押して付ける。
   結果は `labels/mood3_labels.json` に保存される。

3. 学習して重みを書き出す (numpy, scipy, scikit-learn が必要)

   ```bash
   python tools/tone-model/train.py src-tauri/tone_dump.jsonl energy_labels.json mood3_labels.json
   ```

   評価の正解率と、明暗を取り違えた曲が表示される。
   エネルギーは 1 曲ずつ外す評価、明暗は同じアーティストの曲をまとめて外す評価 (アーティストは曲のタグから読む)。
   `energy_labels.json` の代わりに `-` を渡すと、エネルギーの重みは今のまま残して明暗だけ学習し直す。

`src-tauri/src/analysis/tone/` の特徴量の計算を変えたら、1 からやり直す (`cargo test` の `synthetic_song_scores_are_stable` と `model.rs` の固定値テストの期待値も更新する)。
すでに解析済みの曲を再解析するには、DB の `tracks.energy_score` を NULL に戻す。
