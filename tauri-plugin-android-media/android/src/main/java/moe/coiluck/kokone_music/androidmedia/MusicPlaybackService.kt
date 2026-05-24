package moe.coiluck.kokone_music.androidmedia

import android.media.audiofx.LoudnessEnhancer
import android.os.Handler
import android.os.Looper
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.common.util.Util
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import kotlin.math.log10
import kotlin.math.roundToInt

/**
 * Media3 (ExoPlayer + MediaSessionService) ベースの音楽再生サービス。
 *
 * 旧版 (android.media.MediaPlayer + 自前 Service + 自前 MediaSession + 自前通知)
 * からの移行で、以下を Media3 に丸投げする:
 *
 * - 再生エンジン: ExoPlayer (MP3/VBR の Xing/LAME 適切処理、終端まで再生)
 * - キュー / next/prev / seek / volume: ExoPlayer の Player API
 * - ロック画面 / 通知 / Bluetooth / Auto: MediaSessionService が自動配線
 * - foreground service の昇格・降格: MediaSessionService が自動管理
 * - AudioFocus: ExoPlayer に true を渡せば自動でハンドリング
 *
 * 制御は AndroidMediaPlugin が MediaController 経由で行う。
 * このサービス自体は ExoPlayer/MediaSession を作って公開するだけで、
 * 個別のキュー操作 API は持たない (Player API でカバーできるため)。
 */
class MusicPlaybackService : MediaSessionService() {

    private var mediaSession: MediaSession? = null
    private var player: ExoPlayer? = null

    // 増幅 (gain>1) 用。Player.volume は [0,1] で増幅できないため、1.0 超の分は
    // LoudnessEnhancer (audio session に取り付ける標準 AudioEffect) で持ち上げる。
    // デコード/レンダラ経路には一切触れないので、再生の prepare を壊さない。
    private var loudnessEnhancer: LoudnessEnhancer? = null

    private val mainHandler = Handler(Looper.getMainLooper())

    // 現在再生中トラックの正規化ゲイン (MediaItem extras 由来)。
    @Volatile
    private var trackGain: Float = 1.0f

    companion object {
        // プラグイン (同一プロセス) から master volume / 正規化 ON/OFF を渡すための共有点。
        // サービス未生成でも値を保持し、生成時に反映する。Player.volume は [0,1] に
        // クランプされ master>1.0 を運べないため、この経路で受けてサービス側で適用する。
        @Volatile
        var masterVolume: Float = 1.0f
            private set

        @Volatile
        var normalizeEnabled: Boolean = true
            private set

        @Volatile
        private var active: MusicPlaybackService? = null

        fun setMasterVolume(volume: Float) {
            masterVolume = if (volume.isFinite()) volume.coerceIn(0f, 4f) else 1.0f
            active?.recomputeGain()
        }

        fun setNormalizeEnabled(enabled: Boolean) {
            normalizeEnabled = enabled
            active?.recomputeGain()
        }

        // 増幅の上限 (mB)。2000mB = 約 10 倍。過大なブーストによる歪みを防ぐ。
        private const val MAX_BOOST_MB = 2000
    }

    private fun recomputeGain() {
        // 正規化 OFF のときは曲ごとの LUFS ゲインを無視し、master のみ。
        val effectiveTrackGain = if (normalizeEnabled) trackGain else 1.0f
        val total = (masterVolume * effectiveTrackGain).coerceAtLeast(0f)
        // 1.0 以下は Player.volume で減衰、1.0 超は LoudnessEnhancer で増幅。
        val volume = total.coerceIn(0f, 1f)
        val boostMb =
            if (total > 1.0f) (2000.0 * log10(total.toDouble())).roundToInt().coerceIn(0, MAX_BOOST_MB)
            else 0
        // Player.volume は player の applicationLooper でのみ操作可。
        mainHandler.post { player?.volume = volume }
        try {
            loudnessEnhancer?.setTargetGain(boostMb)
        } catch (e: Exception) {
            android.util.Log.w("MusicPlaybackService", "LoudnessEnhancer.setTargetGain failed", e)
        }
    }

    override fun onCreate() {
        super.onCreate()

        val audioAttrs = AudioAttributes.Builder()
            .setUsage(C.USAGE_MEDIA)
            .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
            .build()

        val p = ExoPlayer.Builder(this)
            // handleAudioFocus = true: 通話/ナビなどの transient loss で自動 pause、
            // CAN_DUCK で自動 ducking、復帰で自動 resume。
            .setAudioAttributes(audioAttrs, true)
            // ヘッドホンが抜かれたら一時停止する標準動作
            .setHandleAudioBecomingNoisy(true)
            // prev ボタン: 3 秒経過していれば「曲頭に戻る」、それ未満なら前曲へ。
            .setSeekBackIncrementMs(3000)
            .setSeekForwardIncrementMs(15000)
            .build()

        // 端末スリープ中も再生を継続するためのロック (ローカルファイル用)。
        p.setWakeMode(C.WAKE_MODE_LOCAL)

        // 固定の audio session id を割り当て、そこに LoudnessEnhancer を取り付ける。
        // session id は曲をまたいで不変なので、effect は AudioTrack 再生成後も生き続ける。
        val sessionId = Util.generateAudioSessionIdV21(this)
        p.setAudioSessionId(sessionId)
        try {
            loudnessEnhancer = LoudnessEnhancer(sessionId).apply { enabled = true }
        } catch (e: Exception) {
            // effect が使えない端末ではブーストを諦め、減衰 (Player.volume) のみで動く。
            android.util.Log.w("MusicPlaybackService", "LoudnessEnhancer init failed; boost disabled", e)
        }

        // トラック切替ごとに、その曲の正規化ゲイン (MediaItem extras の "gain") を
        // 取り出し、master と合成して音量へ反映する。
        // extras は JS→Rust→Kotlin で曲ごとに積んである。
        p.addListener(object : Player.Listener {
            override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
                trackGain = mediaItem?.mediaMetadata?.extras?.getFloat("gain", 1.0f) ?: 1.0f
                recomputeGain()
            }
        })

        player = p
        active = this
        // 起動時点で既知の master を反映 (trackGain は曲が乗ったら listener で更新)。
        recomputeGain()
        mediaSession = MediaSession.Builder(this, p).build()
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? {
        return mediaSession
    }

    /**
     * ユーザーがアプリをスワイプで閉じたとき、再生中でなければサービスも停止する。
     * 再生中ならフォアグラウンドサービスとして残し続ける。
     */
    override fun onTaskRemoved(rootIntent: android.content.Intent?) {
        val p = player
        if (p == null || !p.playWhenReady || p.mediaItemCount == 0) {
            stopSelf()
        }
        super.onTaskRemoved(rootIntent)
    }

    override fun onDestroy() {
        if (active === this) active = null
        loudnessEnhancer?.release()
        loudnessEnhancer = null
        mediaSession?.run {
            player.release()
            release()
        }
        mediaSession = null
        player = null
        super.onDestroy()
    }
}
