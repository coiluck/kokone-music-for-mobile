"""曲調モデル (エネルギー 低/中/高・明暗 暗/淡/明) の重みを学習して src-tauri/models/tone_weights.json に書き出す。

使い方:
  python train.py <tone_dump.jsonl> <energy_labels.json> <mood3_labels.json> [出力.json]

- tone_dump.jsonl: `cargo run --release --example tone_dump -- <曲フォルダ> tone_dump.jsonl` の出力
- *_labels.json: [{"id": 曲フォルダからの相対パス, "level": "低"|"中"|"高" または "暗"|"淡"|"明"}, ...]
- energy_labels.json に `-` を渡すと、エネルギーは学習し直さず、出力先にある今の重みをそのまま残す
必要なパッケージ: numpy, scipy, scikit-learn
"""
import json
import sys
import unicodedata
from pathlib import Path

import numpy as np
from scipy.stats import spearmanr
from sklearn.decomposition import PCA
from sklearn.linear_model import LogisticRegression, Ridge
from sklearn.metrics import roc_auc_score
from sklearn.preprocessing import StandardScaler

ENERGY_LEVEL = {"低": 0, "中": 1, "高": 2}
MOOD_LEVEL = {"暗": 0, "淡": 1, "明": 2}
EXCLUDE = {"inst_voice"}  # 歌声の有無は曲調と関係ないので使わない
LOGIT_C = 0.01  # エネルギー: 特徴量の多クラスロジスティック回帰
EMB_RIDGE = 100.0  # エネルギー: 埋め込み (PCA 30 次元) のリッジ回帰
EMB_PCS = 30
# 明暗: 和声の特徴 (h_*) と、明暗に関係する分類ヘッドだけを使う。
# 全特徴や埋め込みを入れると、アーティストごとの音を覚えるだけで知らないアーティストの曲に効かなくなる。
MOOD_HEADS = {
    "happy", "sad", "bright", "tonal", "approachability", "acoustic", "mt_happy", "mt_sad", "mt_dark",
    "mt_melancholic", "mt_positive", "mt_uplifting", "mt_fun", "mt_hopeful", "mt_upbeat", "mt_emotional",
    "mt_dramatic", "mt_romantic",
}
MOOD_C = 0.03  # 明暗: 多クラスロジスティック回帰
CLIP = 3.0  # 明暗: 1 つの特徴の外れ値に振り回されないよう z 値を頭打ちにする


def nfc(s):
    return unicodedata.normalize("NFC", s)


def load(dump_path):
    rows = [json.loads(l) for l in open(dump_path, encoding="utf-8")]
    paths = [nfc(r["path"]) for r in rows]
    names = sorted(rows[0]["feats"])
    F = np.array([[r["feats"][n] for n in names] for r in rows], dtype=float)
    lufs = np.array([np.nan if r["lufs"] is None else r["lufs"] for r in rows])
    emb = np.array([r["emb"] for r in rows], dtype=float)
    # アーティストが分からない曲は、その曲だけのグループにする
    artists = np.array([r.get("artist") or f"\0{i}" for i, r in enumerate(rows)])
    return paths, names, F, lufs, emb, artists


def labels(path, level, paths):
    idx = {p: i for i, p in enumerate(paths)}
    rows = [r for r in json.loads(Path(path).read_text(encoding="utf-8")) if nfc(r["id"]) in idx]
    return np.array([idx[nfc(r["id"])] for r in rows]), np.array([level[r["level"]] for r in rows]), rows


def loo(fit_predict, X, y):
    s = np.empty(len(y))
    for i in range(len(y)):
        m = np.arange(len(y)) != i
        s[i] = fit_predict(X[m], y[m], X[i:i + 1])[0]
    return s


def leave_artist_out(fit_predict, X, y, groups):
    """同じアーティストの曲をまとめて評価に回す。1 曲ずつ外す評価は、同じアーティストの曲が学習側に残るので甘く出る。"""
    s = np.empty(len(y))
    for g in np.unique(groups):
        m = groups != g
        s[~m] = fit_predict(X[m], y[m], X[~m])
    return s


def logit_score(c):
    def f(Xtr, ytr, X):
        m = LogisticRegression(C=c, max_iter=5000).fit(Xtr, ytr)
        return m.predict_proba(X) @ m.classes_
    return f


def ridge_score(alpha):
    return lambda Xtr, ytr, X: Ridge(alpha=alpha).fit(Xtr, ytr).predict(X)


def r(a):
    return [round(float(x), 6) for x in np.ravel(a)]


def train_energy(label_path, paths, names, F, lufs, emb):
    lufs_median = float(np.nanmedian(lufs))
    lufs = np.where(np.isnan(lufs), lufs_median, lufs)
    e_names = [n for n in names if n not in EXCLUDE and not n.startswith("h_")] + ["lufs"]
    Fe = np.column_stack([F[:, [names.index(n) for n in e_names[:-1]]], lufs])
    se = StandardScaler().fit(Fe)
    Ze = se.transform(Fe)
    sm = StandardScaler().fit(emb)
    pca = PCA(n_components=EMB_PCS, random_state=0).fit(sm.transform(emb))
    P = pca.transform(sm.transform(emb))
    ei, ey, _ = labels(label_path, ENERGY_LEVEL, paths)
    s = (loo(logit_score(LOGIT_C), Ze[ei], ey) + loo(ridge_score(EMB_RIDGE), P[ei], ey)) / 2
    lv = np.clip(np.digitize(s, [0.5, 1.5]), 0, 2)
    print(f"エネルギー ({len(ey)} 曲): LOO 正解率 {np.mean(lv == ey):.2f}  順位相関 {spearmanr(s, ey)[0]:.2f}  "
          f"2 段ずれ {np.sum(np.abs(lv - ey) == 2)}")
    logit = LogisticRegression(C=LOGIT_C, max_iter=5000).fit(Ze[ei], ey)
    ridge_e = Ridge(alpha=EMB_RIDGE).fit(P[ei], ey)
    full = (logit.predict_proba(Ze) @ logit.classes_ + ridge_e.predict(P)) / 2
    print("  全曲の推定: " + " ".join(f"{k}{np.sum(np.clip(np.digitize(full, [0.5, 1.5]), 0, 2) == v)}" for k, v in ENERGY_LEVEL.items()))
    assert list(logit.classes_) == [0, 1, 2]
    return lufs_median, {
        "features": {"names": e_names, "mean": r(se.mean_), "std": r(se.scale_)},
        "logit_coef": [r(c) for c in logit.coef_],
        "logit_intercept": r(logit.intercept_),
        "emb_mean": r(sm.mean_), "emb_std": r(sm.scale_),
        "pca_mean": r(pca.mean_), "pca_components": [r(c) for c in pca.components_],
        "ridge_coef": r(ridge_e.coef_), "ridge_intercept": float(ridge_e.intercept_),
    }


def train_mood(label_path, paths, names, F, artists):
    m_names = [n for n in names if n.startswith("h_") or n in MOOD_HEADS]
    Fm = F[:, [names.index(n) for n in m_names]]
    smm = StandardScaler().fit(Fm)
    Zm = np.clip(smm.transform(Fm), -CLIP, CLIP)
    mi, my, mrows = labels(label_path, MOOD_LEVEL, paths)
    s = leave_artist_out(logit_score(MOOD_C), Zm[mi], my, artists[mi])
    # 期待値は中央 (淡) に寄るので 0.5 / 1.5 では切らず、評価時のスコアを 3 等分する値を境界にする
    lo, hi = np.percentile(s, [100 / 3, 200 / 3])
    lv = np.digitize(s, [lo, hi])
    ends = my != 1
    print(f"明暗 ({len(my)} 曲, アーティスト単位の交差検証): 正解率 {np.mean(lv == my):.2f}  順位相関 {spearmanr(s, my)[0]:.2f}  "
          f"明暗の取り違え {np.sum(np.abs(lv - my) == 2)}  明と暗の AUC {roc_auc_score(my[ends] == 2, s[ends]):.2f}")
    level_name = {v: k for k, v in MOOD_LEVEL.items()}
    for j in np.argsort(-np.abs(s - my)):
        if abs(lv[j] - my[j]) == 2:
            print(f"  取り違え: {mrows[j].get('title', mrows[j]['id'])} (ラベル {mrows[j]['level']}, 推定 {level_name[lv[j]]})")
    logit = LogisticRegression(C=MOOD_C, max_iter=5000).fit(Zm[mi], my)
    full = np.digitize(logit.predict_proba(Zm) @ logit.classes_, [lo, hi])
    print("  全曲の推定: " + " ".join(f"{k}{np.sum(full == v)}" for k, v in MOOD_LEVEL.items()))
    assert list(logit.classes_) == [0, 1, 2]
    return {
        "features": {"names": m_names, "mean": r(smm.mean_), "std": r(smm.scale_)},
        "clip": CLIP,
        "logit_coef": [r(c) for c in logit.coef_],
        "logit_intercept": r(logit.intercept_),
        "thresholds": r([lo, hi]),
    }


def main():
    dump, energy_labels, mood_labels = sys.argv[1:4]
    out = Path(sys.argv[4]) if len(sys.argv) > 4 else Path(__file__).parents[2] / "src-tauri/models/tone_weights.json"
    paths, names, F, lufs, emb, artists = load(dump)
    if energy_labels == "-":
        prev = json.loads(out.read_text(encoding="utf-8"))
        lufs_median, energy = prev["lufs_median"], prev["energy"]
    else:
        lufs_median, energy = train_energy(energy_labels, paths, names, F, lufs, emb)
    mood = train_mood(mood_labels, paths, names, F, artists)
    weights = {"lufs_median": lufs_median, "energy": energy, "mood": mood}
    out.write_text(json.dumps(weights, ensure_ascii=False), encoding="utf-8")
    print(f"出力: {out}")


if __name__ == "__main__":
    main()
