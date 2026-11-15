package moe.coiluck.kokone_music

import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.drawable.ColorDrawable
import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import kotlin.properties.Delegates

class MainActivity : TauriActivity() {
    private val systemBarsBackground = SystemBarsBackground()

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)

        ViewCompat.setOnApplyWindowInsetsListener(window.decorView) { view, insets ->
            val systemBars = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
            )
            val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
            view.setPadding(
                systemBars.left,
                systemBars.top,
                systemBars.right,
                maxOf(systemBars.bottom, ime.bottom)
            )
            systemBarsBackground.leftInset = view.paddingLeft
            systemBarsBackground.bottomInset = view.paddingBottom
            insets
        }
    }

    override fun onWebViewCreate(webView: WebView) {
        webView.addJavascriptInterface(SystemBarsBridge(), "AndroidSystemBars")
    }

    // decorView の padding 部分 (ステータスバー・カメラ切り欠き・ナビゲーションバー) を
    // アプリのテーマ背景色で塗り、アイコンの明暗も背景に合わせる
    private inner class SystemBarsBridge {
        @JavascriptInterface
        fun setColors(bgHex: String, mildHex: String, isLight: Boolean) {
            val bg = Color.parseColor(bgHex)
            val mild = Color.parseColor(mildHex)
            runOnUiThread {
                systemBarsBackground.color = bg
                systemBarsBackground.mildColor = mild
                window.decorView.background = systemBarsBackground
                WindowInsetsControllerCompat(window, window.decorView).apply {
                    isAppearanceLightStatusBars = isLight
                    isAppearanceLightNavigationBars = isLight
                }
            }
        }

        // cssPx: WebView 左端からサイドナビ右端までの幅。サイドナビが無いレイアウトでは 0
        @JavascriptInterface
        fun setSideNavWidth(cssPx: Float) {
            runOnUiThread {
                systemBarsBackground.sideNavWidth = cssPx * resources.displayMetrics.density
            }
        }
    }
}

// 全体を color で塗り、mildColor の領域だけ塗り直す。
// スマホレイアウトは下端の余白、PC レイアウトは左端からサイドナビまでの列が mildColor の領域
private class SystemBarsBackground : ColorDrawable() {
    private val mildPaint = Paint()

    var mildColor by Delegates.observable(0) { _, _, _ -> invalidateSelf() }
    var leftInset by Delegates.observable(0) { _, _, _ -> invalidateSelf() }
    var bottomInset by Delegates.observable(0) { _, _, _ -> invalidateSelf() }
    var sideNavWidth by Delegates.observable(0f) { _, _, _ -> invalidateSelf() }

    override fun draw(canvas: Canvas) {
        super.draw(canvas)
        mildPaint.color = mildColor
        val left = bounds.left.toFloat()
        val right = bounds.right.toFloat()
        val top = bounds.top.toFloat()
        val bottom = bounds.bottom.toFloat()
        if (sideNavWidth > 0f) {
            canvas.drawRect(left, top, left + leftInset + sideNavWidth, bottom, mildPaint)
        } else {
            canvas.drawRect(left, bottom - bottomInset, right, bottom, mildPaint)
        }
    }
}
