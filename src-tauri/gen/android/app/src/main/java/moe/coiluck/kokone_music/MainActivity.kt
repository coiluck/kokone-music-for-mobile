package moe.coiluck.kokone_music

import android.os.Bundle
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
    companion object {
        // Rust 側 (android_media.rs) から JNI で取得して使う。
        // requestPermissions には Activity が必要だが、ndk_context が返すのは Context のため。
        @JvmStatic
        @Volatile
        var instance: MainActivity? = null
            private set
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        instance = this

        ViewCompat.setOnApplyWindowInsetsListener(window.decorView) { view, insets ->
            val statusBarInsets = insets.getInsets(WindowInsetsCompat.Type.statusBars())
            view.setPadding(0, statusBarInsets.top, 0, 0)
            insets
        }
    }

    override fun onDestroy() {
        if (instance === this) instance = null
        super.onDestroy()
    }
}