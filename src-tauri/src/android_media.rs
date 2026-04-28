// Android 専用: MediaStore へのアクセスを Kotlin の MediaStoreHelper 経由で行う。
// 非 Android プラットフォームではスタブ実装を返す。

#[cfg(target_os = "android")]
mod imp {
    use jni::objects::{JObject, JObjectArray, JString, JValue};
    use jni::JavaVM;

    fn with_env<F, T>(f: F) -> Result<T, String>
    where
        F: FnOnce(&mut jni::JNIEnv, &JObject) -> Result<T, String>,
    {
        let ctx = ndk_context::android_context();
        let vm = unsafe { JavaVM::from_raw(ctx.vm().cast()) }.map_err(|e| e.to_string())?;
        let mut env = vm.attach_current_thread().map_err(|e| e.to_string())?;
        // ndk_context が保持している Context は VM が管理しているグローバル参照のため
        // ここでは drop させずにそのまま使う (Drop しても VM 側の参照は残る)。
        let context = unsafe { JObject::from_raw(ctx.context().cast()) };
        f(&mut env, &context)
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

    pub fn query_audio_files() -> Result<Vec<String>, String> {
        with_env(|env, context| {
            let res = env
                .call_static_method(
                    "moe/coiluck/kokone_music/MediaStoreHelper",
                    "queryAudioFiles",
                    "(Landroid/content/Context;)[Ljava/lang/String;",
                    &[JValue::Object(context)],
                )
                .map_err(|e| e.to_string())?;

            let arr_obj = res.l().map_err(|e| e.to_string())?;
            let arr = JObjectArray::from(arr_obj);
            let len = env.get_array_length(&arr).map_err(|e| e.to_string())?;

            let mut out = Vec::with_capacity(len as usize);
            for i in 0..len {
                let elem = env
                    .get_object_array_element(&arr, i)
                    .map_err(|e| e.to_string())?;
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
}

#[cfg(not(target_os = "android"))]
mod imp {
    pub fn has_audio_permission() -> Result<bool, String> {
        Ok(true)
    }

    pub fn request_audio_permission() -> Result<(), String> {
        Ok(())
    }

    pub fn query_audio_files() -> Result<Vec<String>, String> {
        Ok(Vec::new())
    }
}

// ---------------------------------------------------------------------------
// 内部 API（scan_music.rs から呼ぶ）
// ---------------------------------------------------------------------------
pub fn query_audio_files() -> Result<Vec<String>, String> {
    imp::query_audio_files()
}

// ---------------------------------------------------------------------------
// Tauri コマンド（フロントから直接呼ぶ）
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
    let files = imp::query_audio_files()?;
    let mut folders: BTreeSet<String> = BTreeSet::new();
    for path in files {
        if let Some(parent) = std::path::Path::new(&path).parent() {
            if let Some(s) = parent.to_str() {
                folders.insert(s.to_string());
            }
        }
    }
    Ok(folders.into_iter().collect())
}
