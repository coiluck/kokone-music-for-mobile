package moe.coiluck.kokone_music

import android.app.Activity
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.MediaStore
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat

// Rust(JNI) から呼び出される MediaStore アクセスのヘルパー。
// Tauri のフルプラグインは作らず、static メソッドだけを公開して
// android_media.rs から直接 call_static_method する。
object MediaStoreHelper {
    private const val REQUEST_CODE_AUDIO = 0xA0D10

    private fun audioPermission(): String {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            "android.permission.READ_MEDIA_AUDIO"
        } else {
            "android.permission.READ_EXTERNAL_STORAGE"
        }
    }

    @JvmStatic
    fun hasAudioPermission(context: Context): Boolean {
        return ContextCompat.checkSelfPermission(context, audioPermission()) ==
            PackageManager.PERMISSION_GRANTED
    }

    // 権限ダイアログを出す。結果は MainActivity.onRequestPermissionsResult で受ける。
    // 同期に結果を返す API を JNI 経由で組むのは煩雑なので、
    // フロントは「リクエスト → ユーザー操作 → 再度 hasAudioPermission を確認」のループにする。
    @JvmStatic
    fun requestAudioPermission(activity: Activity) {
        if (hasAudioPermission(activity)) return
        // requestPermissions は UI スレッドからの呼び出しが必須。
        // Rust(JNI) からの呼び出しはバックグラウンドスレッドのため、main looper に post する。
        Handler(Looper.getMainLooper()).post {
            ActivityCompat.requestPermissions(
                activity,
                arrayOf(audioPermission()),
                REQUEST_CODE_AUDIO,
            )
        }
    }

    // MediaStore.Audio から DATA カラム（絶対パス）を全件返す。
    // 権限が無いときは空配列。
    @JvmStatic
    fun queryAudioFiles(context: Context): Array<String> {
        if (!hasAudioPermission(context)) return emptyArray()

        val uri = MediaStore.Audio.Media.EXTERNAL_CONTENT_URI
        val projection = arrayOf(MediaStore.Audio.Media.DATA)
        val selection = "${MediaStore.Audio.Media.IS_MUSIC} != 0"

        val out = ArrayList<String>()
        context.contentResolver.query(uri, projection, selection, null, null)?.use { cursor ->
            val dataIdx = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.DATA)
            while (cursor.moveToNext()) {
                val path = cursor.getString(dataIdx) ?: continue
                if (path.isNotEmpty()) out.add(path)
            }
        }
        return out.toTypedArray()
    }
}
