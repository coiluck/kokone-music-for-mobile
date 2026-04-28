// Android 専用: MediaStore へのアクセスを Kotlin の MediaStoreHelper 経由で行う。
// 非 Android プラットフォームではスタブ実装を返す。
//
// 設計方針:
//   - scoped storage 環境では Rust 側から /storage/emulated/0/... を直接 fopen
//     できない場合がある (lofty::Probe::open / std::fs::File::open が EACCES)。
//   - そのため、ファイルの中身を読む処理 (タグ取得・ハッシュ計算) は
//     すべて Kotlin 側 (ContentResolver.openFileDescriptor 経由) で行い、
//     Rust 側は MediaStore から得た「メタデータ + audio_id」だけで動くようにする。

#[cfg(target_os = "android")]
mod imp {
    use jni::objects::{JObject, JObjectArray, JString, JValue};
    use jni::JavaVM;

    /// Android Context (アプリ全体のグローバル参照) と JNIEnv をクロージャに渡す。
    /// 呼び出しスレッドは VM にアタッチされる。スコープを抜けると AttachGuard が
    /// drop され、必要に応じて DetachCurrentThread される。
    fn with_env<F, T>(f: F) -> Result<T, String>
    where
        F: FnOnce(&mut jni::JNIEnv, &JObject) -> Result<T, String>,
    {
        let ctx = ndk_context::android_context();
        let vm = unsafe { JavaVM::from_raw(ctx.vm().cast()) }.map_err(|e| e.to_string())?;
        let mut env = vm.attach_current_thread().map_err(|e| e.to_string())?;
        // ndk_context が保持している Context は VM 管理のグローバル参照。
        // JObject::from_raw で参照を借りるだけ (JObject の Drop は no-op なので
        // ここで二重解放にはならない)。
        let context = unsafe { JObject::from_raw(ctx.context().cast()) };
        let result = f(&mut env, &context);
        // Java 側で例外が立ったままだと次の呼び出しでクラッシュするので、
        // 念のためここで拾ってクリアする。
        if env.exception_check().unwrap_or(false) {
            let _ = env.exception_describe();
            let _ = env.exception_clear();
        }
        result
    }

    pub fn has_audio_permission() -> Result<bool, String> {
        with_env(|env, context| {
            let res = env
                .call_static_method(
                    "moe/coiluck/kokone_music/MediaStoreHelper",
                    "hasAudioPermission",
                    "(Landroid/content/Context;)Z",
                    &[JValue::Object(context)],
                )
                .map_err(|e| e.to_string())?;
            res.z().map_err(|e| e.to_string())
        })
    }

    pub fn request_audio_permission() -> Result<(), String> {
        with_env(|env, _context| {
            // requestPermissions は Activity が必要。
            // MainActivity.instance を静的フィールドから取り出して渡す。
            let activity = env
                .get_static_field(
                    "moe/coiluck/kokone_music/MainActivity",
                    "instance",
                    "Lmoe/coiluck/kokone_music/MainActivity;",
                )
                .map_err(|e| e.to_string())?
                .l()
                .map_err(|e| e.to_string())?;

            if activity.is_null() {
                return Err("MainActivity not initialized".to_string());
            }

            env.call_static_method(
                "moe/coiluck/kokone_music/MediaStoreHelper",
                "requestAudioPermission",
                "(Landroid/app/Activity;)V",
                &[JValue::Object(&activity)],
            )
            .map_err(|e| e.to_string())?;
            Ok(())
        })
    }

    /// Kotlin 側の queryAudioMetadata から TSV 行を取得して、
    /// 1行を String として返す。
    pub fn query_audio_metadata_lines() -> Result<Vec<String>, String> {
        with_env(|env, context| {
            let res = env
                .call_static_method(
                    "moe/coiluck/kokone_music/MediaStoreHelper",
                    "queryAudioMetadata",
                    "(Landroid/content/Context;)[Ljava/lang/String;",
                    &[JValue::Object(context)],
                )
                .map_err(|e| e.to_string())?;

            let arr_obj = res.l().map_err(|e| e.to_string())?;
            if arr_obj.is_null() {
                return Ok(Vec::new());
            }
            let arr = JObjectArray::from(arr_obj);
            let len = env.get_array_length(&arr).map_err(|e| e.to_string())?;

            let mut out = Vec::with_capacity(len as usize);
            for i in 0..len {
                let elem = env
                    .get_object_array_element(&arr, i)
                    .map_err(|e| e.to_string())?;
                if elem.is_null() {
                    continue;
                }
                let jstr = JString::from(elem);
                let s: String = env
                    .get_string(&jstr)
                    .map_err(|e| e.to_string())?
                    .into();
                out.push(s);
            }
            Ok(out)
        })
    }

    /// Audio ID を指定して、ファイル内容のハッシュを Kotlin 側で計算してもらう。
    /// is_mp3 = true なら mp3 音声本体のみ、false ならファイル全体。
    pub fn audio_hash(audio_id: i64, is_mp3: bool) -> Result<String, String> {
        with_env(|env, context| {
            let res = env
                .call_static_method(
                    "moe/coiluck/kokone_music/MediaStoreHelper",
                    "audioHash",
                    "(Landroid/content/Context;JZ)Ljava/lang/String;",
                    &[
                        JValue::Object(context),
                        JValue::Long(audio_id),
                        JValue::Bool(if is_mp3 { 1 } else { 0 }),
                    ],
                )
                .map_err(|e| e.to_string())?;

            let obj = res.l().map_err(|e| e.to_string())?;
            if obj.is_null() {
                return Ok(String::new());
            }
            let jstr = JString::from(obj);
            let s: String = env
                .get_string(&jstr)
                .map_err(|e| e.to_string())?
                .into();
            Ok(s)
        })
    }
}

#[cfg(not(target_os = "android"))]
mod imp {
    pub fn has_audio_permission() -> Result<bool, String> {
        Ok(true)
    }

    pub fn request_audio_permission() -> Result<(), String> {
        Ok(())
    }

    pub fn query_audio_metadata_lines() -> Result<Vec<String>, String> {
        Ok(Vec::new())
    }

    pub fn audio_hash(_audio_id: i64, _is_mp3: bool) -> Result<String, String> {
        Ok(String::new())
    }
}

// ---------------------------------------------------------------------------
// メタデータ構造体 (scan_music.rs から使う)
// ---------------------------------------------------------------------------
#[derive(Debug, Clone)]
pub struct AndroidAudioMeta {
    pub id: i64,
    /// 表示用の絶対パス相当 (DATA カラムが取れればそれ、無ければ
    /// "/storage/emulated/0/{RELATIVE_PATH}{DISPLAY_NAME}" の擬似パス)。
    /// scan-folder マッチングと UI 表示にだけ使い、ファイル open には使わない。
    pub display_path: String,
    pub display_name: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub duration_ms: i64,
    pub size_bytes: i64,
}

fn parse_meta_line(line: &str) -> Option<AndroidAudioMeta> {
    // queryAudioMetadata が返す TSV: id, displayPath, displayName, title, artist, album, durationMs, sizeBytes
    let cols: Vec<&str> = line.split('\t').collect();
    if cols.len() < 8 {
        return None;
    }
    let id: i64 = cols[0].parse().ok()?;
    let display_path = cols[1].to_string();
    let display_name = cols[2].to_string();
    let title = cols[3].to_string();
    let artist = cols[4].to_string();
    let album = cols[5].to_string();
    let duration_ms: i64 = cols[6].parse().unwrap_or(0);
    let size_bytes: i64 = cols[7].parse().unwrap_or(0);
    if display_path.is_empty() {
        return None;
    }
    Some(AndroidAudioMeta {
        id,
        display_path,
        display_name,
        title,
        artist,
        album,
        duration_ms,
        size_bytes,
    })
}

// ---------------------------------------------------------------------------
// 内部 API (scan_music.rs から呼ぶ)
// ---------------------------------------------------------------------------

/// MediaStore に登録されている音楽ファイルのメタデータ一覧を返す。
/// scan_music.rs (Android 版) がここから候補を作る。
pub fn query_audio_metadata() -> Result<Vec<AndroidAudioMeta>, String> {
    let lines = imp::query_audio_metadata_lines()?;
    let mut out = Vec::with_capacity(lines.len());
    for line in lines {
        if let Some(m) = parse_meta_line(&line) {
            out.push(m);
        }
    }
    Ok(out)
}

/// 指定された Audio ID のファイル内容のハッシュを返す。
/// Kotlin 側で ContentResolver 経由で読むので scoped storage でも安全。
pub fn audio_hash(audio_id: i64, is_mp3: bool) -> Result<String, String> {
    imp::audio_hash(audio_id, is_mp3)
}

// ---------------------------------------------------------------------------
// Tauri コマンド (フロントから直接呼ぶ)
// ---------------------------------------------------------------------------
#[tauri::command]
pub fn android_has_audio_permission() -> Result<bool, String> {
    imp::has_audio_permission()
}

#[tauri::command]
pub fn android_request_audio_permission() -> Result<(), String> {
    imp::request_audio_permission()
}

/// MediaStore に登録されている音楽ファイルが置かれている「フォルダ一覧」を返す。
/// フロントの「フォルダ選択モーダル」で表示するためのもの。
/// 各ファイルの親ディレクトリ集合を distinct でソートして返す。
#[tauri::command]
pub fn android_list_audio_folders() -> Result<Vec<String>, String> {
    use std::collections::BTreeSet;
    let metas = query_audio_metadata()?;
    let mut folders: BTreeSet<String> = BTreeSet::new();
    for m in metas {
        if let Some(parent) = std::path::Path::new(&m.display_path).parent() {
            if let Some(s) = parent.to_str() {
                folders.insert(s.to_string());
            }
        }
    }
    Ok(folders.into_iter().collect())
}