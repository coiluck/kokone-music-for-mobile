# Kokone Music (SymPony Music)

Tauri 2 + React + Vite で作られたデスクトップ／Android 向けミュージックプレイヤー。

---

## 必要な環境

| ツール | バージョン目安 | 用途 |
| --- | --- | --- |
| Node.js | 20 以上 (Vite 7 / TypeScript 6 要件) | フロントエンド |
| npm | Node.js 同梱版 | パッケージ管理 |
| Rust (stable) | 最新 stable | Tauri バックエンド |
| Tauri prerequisites | OS 別 | https://v2.tauri.app/start/prerequisites/ を参照 |
| Android Studio | Hedgehog 以降 | Android ビルド時のみ |
| JDK | 17 以上 | Android ビルド時のみ |
| Android SDK / NDK | `compileSdk = 36`, `minSdk = 24` 対応版 | Android ビルド時のみ |

Android ビルドを行う場合は `ANDROID_HOME` / `NDK_HOME` 等の環境変数を Tauri 公式ドキュメントの手順通りに設定してください。

---

## セットアップ

```bash
git clone https://github.com/coiluck/kokone-music-for-mobile.git
cd kokone-music-for-mobile
npm install
```

`npm install` で以下が解決されます。

- フロントエンドの npm 依存関係
- ローカルパス参照のプラグイン `tauri-plugin-android-media-api` (`file:./tauri-plugin-android-media`)

Rust 側の依存 (`src-tauri/Cargo.toml`, `tauri-plugin-android-media/Cargo.toml`) は最初の `tauri dev` / `tauri build` 実行時に `cargo` が自動で取得します。

---

## 開発

### デスクトップで起動

```bash
npm run tauri dev
```

`http://localhost:1420` で Vite が立ち上がり、Tauri ウィンドウが開きます。

### Android で起動

```bash
npm run tauri android dev
```

`src-tauri/gen/android/` 配下の Android プロジェクトは追跡対象のため、`tauri android init` は不要です。Android Studio / `adb` で検出されたデバイス・エミュレーターに対して起動します。

---

## ビルド

### デスクトップ

```bash
npm run tauri build
```

成果物は `src-tauri/target/release/bundle/` に出力されます。

### Android (APK / AAB)

```bash
npm run tauri android build
```

成果物は `src-tauri/gen/android/app/build/outputs/` に出力されます。

---

## ディレクトリ構成 (概要)

```
.
├── src/                         # React / TypeScript フロントエンド
├── public/                      # 静的アセット (アイコン、フォント、翻訳 JSON)
├── src-tauri/                   # Tauri (Rust) バックエンド
│   ├── src/                     # Rust ソース
│   ├── capabilities/            # Tauri ACL
│   ├── icons/                   # アプリアイコン
│   └── gen/android/             # Android プロジェクト (Tauri が初期生成、コミット対象)
├── tauri-plugin-android-media/  # 自作 Tauri プラグイン (Android MediaStore 等)
│   ├── src/                     # Rust 側
│   ├── android/                 # Kotlin 側
│   ├── guest-js/                # TypeScript ソース
│   └── dist-js/                 # tsc 出力 (npm 解決のためコミット対象)
├── index.html
├── vite.config.ts
├── tsconfig.json
├── tsconfig.node.json
└── package.json
```

---

## Git で追跡していないもの

`.gitignore` で除外しているのは「Tauri / Cargo / Gradle コマンドにより同一内容が再生成可能」なものに限ります。

- `node_modules/` — `npm install` で生成
- `dist/` — `npm run build` で生成
- `src-tauri/target/`, `tauri-plugin-android-media/target/` — `cargo build` で生成
- `**/build/`, `**/.gradle/` — Gradle ビルド成果物・キャッシュ
- `tauri-plugin-android-media/android/.tauri/` — プラグインの `build.rs` (`tauri_plugin::Builder`) がビルド時に自動配置する Tauri Android API
- `src-tauri/gen/android/.tauri/`, `src-tauri/gen/android/tauri.settings.gradle` — Tauri がビルド時に上書きするファイル

これらが無い状態でも `git clone` → `npm install` → `npm run tauri dev` (または `android dev`) を行えば自動で再生成されます。
