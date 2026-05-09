package moe.coiluck.kokone_music.androidmedia

import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService

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

        player = p
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
        mediaSession?.run {
            player.release()
            release()
        }
        mediaSession = null
        player = null
        super.onDestroy()
    }
}
