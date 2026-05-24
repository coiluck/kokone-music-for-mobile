package moe.coiluck.kokone_music.androidmedia

import android.Manifest
import android.app.Activity
import android.content.ComponentName
import android.content.ContentUris
import android.content.Context
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.MediaStore
import androidx.core.content.ContextCompat
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.Permission
import app.tauri.annotation.PermissionCallback
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSArray
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import com.google.common.util.concurrent.ListenableFuture
import org.json.JSONObject
import java.io.FileInputStream
import java.security.MessageDigest

@InvokeArg
class AudioHashArgs {
    var audioId: Long = 0
    var isMp3: Boolean = false
}

@InvokeArg
class OpenAudioFdArgs {
    var audioId: Long = 0
}

@InvokeArg
class AudioIdsForPathsArg {
    var paths: Array<String> = emptyArray()
}

@InvokeArg
class PlaybackQueueItemArg {
    var trackId: Long = 0
    var audioId: Long = 0
    var title: String = ""
    var artist: String = ""
    var gain: Float = 1.0f
}

@InvokeArg
class PlaybackSetQueueArg {
    lateinit var items: Array<PlaybackQueueItemArg>
    var startIndex: Int = -1
}

@InvokeArg
class PlaybackEnqueueArg {
    lateinit var item: PlaybackQueueItemArg
}

@InvokeArg
class PlaybackAppendQueueArg {
    lateinit var items: Array<PlaybackQueueItemArg>
}

@InvokeArg
class PlaybackIndexArg {
    var index: Int = -1
}

@InvokeArg
class PlaybackMoveArg {
    var from: Int = -1
    var to: Int = -1
}

@InvokeArg
class PlaybackSeekArg {
    var positionMs: Long = 0
}

@InvokeArg
class PlaybackVolumeArg {
    var volume: Float = 1.0f
    var normalize: Boolean = true
}

@TauriPlugin(
    permissions = [
        Permission(strings = [Manifest.permission.READ_MEDIA_AUDIO], alias = "audio33"),
        Permission(strings = [Manifest.permission.READ_EXTERNAL_STORAGE], alias = "audio"),
    ]
)
class AndroidMediaPlugin(private val activity: Activity) : Plugin(activity) {

    // -----------------------------------------------------------------------
    // MediaController (Media3) — 再生制御の唯一の入口
    // -----------------------------------------------------------------------

    private var controller: MediaController? = null
    private var controllerFuture: ListenableFuture<MediaController>? = null

    // 4Hz position 通知用 (UI のシークバー駆動)
    private val mainHandler = android.os.Handler(android.os.Looper.getMainLooper())
    private val positionRunnable = object : Runnable {
        override fun run() {
            val c = controller ?: return
            try {
                if (c.isPlaying) {
                    val pos = c.currentPosition
                    val dur = if (c.duration == C.TIME_UNSET) 0L else c.duration
                    emitPosition(pos, dur)
                }
            } catch (_: Exception) { /* ignore */ }
            mainHandler.postDelayed(this, 250)
        }
    }

    /**
     * MediaController を非同期で接続する。MediaSessionService は startService 不要で、
     * SessionToken 経由で connect すれば自動的に起動する。
     */
    private fun ensureControllerStarted() {
        if (controller != null || controllerFuture != null) return
        val ctx = activity
        val token = SessionToken(
            ctx,
            ComponentName(ctx, MusicPlaybackService::class.java)
        )
        val fut = MediaController.Builder(ctx, token).buildAsync()
        controllerFuture = fut
        fut.addListener({
            try {
                val c = fut.get()
                controller = c
                c.addListener(playerListener)
                // 接続後の現在状態を JS にも一度伝える (snapshot 的)
                emitTrackChanged(c.currentMediaItem, c.currentMediaItemIndex)
                emitPlayingChanged(c.isPlaying)
            } catch (e: Exception) {
                android.util.Log.w("AndroidMediaPlugin", "MediaController connect failed", e)
            }
        }, ContextCompat.getMainExecutor(ctx))
    }

    /**
     * メインスレッドで MediaController を使う。Tauri @Command は背景スレッドから呼ばれるため、
     * 必ずメインに dispatch する (Player API はコントローラの applicationLooper に縛られる)。
     */
    private fun withController(action: (MediaController) -> Unit) {
        ensureControllerStarted()
        activity.runOnUiThread {
            val c = controller
            if (c != null) {
                action(c)
            } else {
                val fut = controllerFuture ?: return@runOnUiThread
                fut.addListener({
                    try {
                        val c2 = fut.get()
                        action(c2)
                    } catch (_: Exception) {}
                }, ContextCompat.getMainExecutor(activity))
            }
        }
    }

    // -----------------------------------------------------------------------
    // Player.Listener: ExoPlayer の状態変化を JS に転送
    // -----------------------------------------------------------------------

    private val playerListener = object : Player.Listener {
        override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
            val idx = controller?.currentMediaItemIndex ?: -1
            emitTrackChanged(mediaItem, idx)
        }

        override fun onIsPlayingChanged(isPlaying: Boolean) {
            emitPlayingChanged(isPlaying)
            if (isPlaying) {
                mainHandler.removeCallbacks(positionRunnable)
                mainHandler.post(positionRunnable)
            } else {
                mainHandler.removeCallbacks(positionRunnable)
            }
        }

        override fun onPlaybackStateChanged(state: Int) {
            if (state == Player.STATE_ENDED) {
                emitQueueEnded()
            }
        }

        override fun onPlayerError(error: PlaybackException) {
            emitError("ExoPlayer error: code=${error.errorCode} ${error.message}")
        }
    }

    private fun emitTrackChanged(mediaItem: MediaItem?, index: Int) {
        val obj = JSObject()
        obj.put("type", "trackChanged")
        obj.put("index", index)
        if (mediaItem == null) {
            obj.put("item", JSONObject.NULL)
        } else {
            val it = JSObject()
            it.put("trackId", mediaItem.mediaId.toLongOrNull() ?: -1L)
            it.put("title", mediaItem.mediaMetadata.title?.toString() ?: "")
            it.put("artist", mediaItem.mediaMetadata.artist?.toString() ?: "")
            obj.put("item", it)
        }
        trigger("playbackEvent", obj)
    }

    private fun emitPlayingChanged(isPlaying: Boolean) {
        val obj = JSObject()
        obj.put("type", "playingChanged")
        obj.put("isPlaying", isPlaying)
        trigger("playbackEvent", obj)
    }

    private fun emitPosition(positionMs: Long, durationMs: Long, fromSeek: Boolean = false) {
        val obj = JSObject()
        obj.put("type", "positionChanged")
        obj.put("positionMs", positionMs)
        obj.put("durationMs", durationMs)
        if (fromSeek) obj.put("fromSeek", true)
        trigger("playbackEvent", obj)
    }

    private fun emitQueueEnded() {
        val obj = JSObject()
        obj.put("type", "queueEnded")
        trigger("playbackEvent", obj)
    }

    private fun emitError(message: String) {
        val obj = JSObject()
        obj.put("type", "error")
        obj.put("message", message)
        trigger("playbackEvent", obj)
    }

    // -----------------------------------------------------------------------
    // QueueItem -> MediaItem
    //   gain (LUFS 正規化係数) は MediaItem の extras に乗せておく。
    //   音量適用 (master × gain) はサービス側が担う: 減衰は Player.volume、
    //   増幅 (>1.0) は LoudnessEnhancer。controller 側では volume を触らない。
    // -----------------------------------------------------------------------

    private fun toMediaItem(arg: PlaybackQueueItemArg): MediaItem {
        val uri: Uri = ContentUris.withAppendedId(
            MediaStore.Audio.Media.EXTERNAL_CONTENT_URI,
            arg.audioId
        )
        val extras = Bundle().apply { putFloat("gain", arg.gain) }
        return MediaItem.Builder()
            .setMediaId(arg.trackId.toString())
            .setUri(uri)
            .setMediaMetadata(
                MediaMetadata.Builder()
                    .setTitle(arg.title)
                    .setArtist(arg.artist)
                    .setExtras(extras)
                    .build()
            )
            .build()
    }

    // -----------------------------------------------------------------------
    // Permission
    // -----------------------------------------------------------------------

    @Command
    fun hasAudioPermission(invoke: Invoke) {
        val ret = JSObject()
        ret.put("granted", hasAudioPermissionInternal(activity))
        invoke.resolve(ret)
    }

    @Command
    fun requestAudioPermission(invoke: Invoke) {
        if (hasAudioPermissionInternal(activity)) {
            val ret = JSObject()
            ret.put("granted", true)
            invoke.resolve(ret)
            return
        }
        val alias = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) "audio33" else "audio"
        requestPermissionForAlias(alias, invoke, "audioPermissionCallback")
    }

    @PermissionCallback
    private fun audioPermissionCallback(invoke: Invoke) {
        val ret = JSObject()
        ret.put("granted", hasAudioPermissionInternal(activity))
        invoke.resolve(ret)
    }

    private fun hasAudioPermissionInternal(context: Context): Boolean {
        val perm = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            Manifest.permission.READ_MEDIA_AUDIO
        } else {
            Manifest.permission.READ_EXTERNAL_STORAGE
        }
        return ContextCompat.checkSelfPermission(context, perm) == PackageManager.PERMISSION_GRANTED
    }

    // -----------------------------------------------------------------------
    // Audio metadata enumeration
    // -----------------------------------------------------------------------

    @Command
    fun queryAudioMetadata(invoke: Invoke) {
        val ret = JSObject()
        if (!hasAudioPermissionInternal(activity)) {
            ret.put("items", JSArray())
            invoke.resolve(ret)
            return
        }

        val items = JSArray()
        val uri = MediaStore.Audio.Media.EXTERNAL_CONTENT_URI
        val projection = arrayOf(
            MediaStore.Audio.Media._ID,
            MediaStore.Audio.Media.DISPLAY_NAME,
            MediaStore.Audio.Media.RELATIVE_PATH,
            MediaStore.Audio.Media.TITLE,
            MediaStore.Audio.Media.ARTIST,
            MediaStore.Audio.Media.ALBUM,
            MediaStore.Audio.Media.DURATION,
            MediaStore.Audio.Media.SIZE,
            MediaStore.Audio.Media.DATA,
        )
        val selection = "${MediaStore.Audio.Media.IS_MUSIC} != 0"

        try {
            activity.contentResolver.query(uri, projection, selection, null, null)?.use { cursor ->
                val idIdx = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media._ID)
                val nameIdx = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.DISPLAY_NAME)
                val relIdx = cursor.getColumnIndex(MediaStore.Audio.Media.RELATIVE_PATH)
                val titleIdx = cursor.getColumnIndex(MediaStore.Audio.Media.TITLE)
                val artistIdx = cursor.getColumnIndex(MediaStore.Audio.Media.ARTIST)
                val albumIdx = cursor.getColumnIndex(MediaStore.Audio.Media.ALBUM)
                val durIdx = cursor.getColumnIndex(MediaStore.Audio.Media.DURATION)
                val sizeIdx = cursor.getColumnIndex(MediaStore.Audio.Media.SIZE)
                val dataIdx = cursor.getColumnIndex(MediaStore.Audio.Media.DATA)

                while (cursor.moveToNext()) {
                    val id = cursor.getLong(idIdx)
                    val displayName = cursor.getString(nameIdx) ?: continue
                    if (displayName.isEmpty()) continue

                    val relPath = if (relIdx >= 0) cursor.getString(relIdx) ?: "" else ""
                    val data = if (dataIdx >= 0) cursor.getString(dataIdx) ?: "" else ""

                    val displayPath = if (data.isNotEmpty()) {
                        data
                    } else {
                        val rel = if (relPath.endsWith('/')) relPath else "$relPath/"
                        "/storage/emulated/0/$rel$displayName"
                    }

                    val title = (if (titleIdx >= 0) cursor.getString(titleIdx) else null) ?: ""
                    val artist = (if (artistIdx >= 0) cursor.getString(artistIdx) else null) ?: ""
                    val album = (if (albumIdx >= 0) cursor.getString(albumIdx) else null) ?: ""
                    val durationMs = if (durIdx >= 0) cursor.getLong(durIdx) else 0L
                    val sizeBytes = if (sizeIdx >= 0) cursor.getLong(sizeIdx) else 0L

                    val item = JSObject()
                    item.put("id", id)
                    item.put("displayPath", displayPath)
                    item.put("displayName", displayName)
                    item.put("title", title)
                    item.put("artist", artist)
                    item.put("album", album)
                    item.put("durationMs", durationMs)
                    item.put("sizeBytes", sizeBytes)
                    items.put(item)
                }
            }
        } catch (e: Exception) {
            android.util.Log.w("AndroidMediaPlugin", "queryAudioMetadata failed", e)
            ret.put("items", JSArray())
            invoke.resolve(ret)
            return
        }
        ret.put("items", items)
        invoke.resolve(ret)
    }

    // -----------------------------------------------------------------------
    // Hash (Rust 側から fopen できないので Kotlin 側で計算する)
    // -----------------------------------------------------------------------

    @Command
    fun audioHash(invoke: Invoke) {
        val args = invoke.parseArgs(AudioHashArgs::class.java)
        val uri = ContentUris.withAppendedId(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, args.audioId)
        val hash = try {
            activity.contentResolver.openFileDescriptor(uri, "r")?.use { pfd ->
                FileInputStream(pfd.fileDescriptor).use { fis ->
                    val md = MessageDigest.getInstance("SHA-256")
                    val totalLen = pfd.statSize.takeIf { it >= 0 } ?: -1L
                    if (args.isMp3 && totalLen >= 10) {
                        hashMp3Body(fis, totalLen, md)
                    } else {
                        hashAll(fis, md)
                    }
                    bytesToHex(md.digest())
                } ?: ""
            } ?: ""
        } catch (e: Exception) {
            android.util.Log.w("AndroidMediaPlugin", "audioHash failed for id=${args.audioId}", e)
            ""
        }
        val ret = JSObject()
        ret.put("hash", hash)
        invoke.resolve(ret)
    }

    // -----------------------------------------------------------------------
    // Open fd (LUFS 解析用に Rust 側へ生 fd を渡す)
    //
    // detachFd() で ParcelFileDescriptor から所有権を切り離し、生の int fd を返す。
    // 以降この fd を閉じる責任は呼び出し側 (Rust の File::from_raw_fd) に移る。
    // 失敗時は -1 を返す。
    // -----------------------------------------------------------------------
    @Command
    fun openAudioFd(invoke: Invoke) {
        val args = invoke.parseArgs(OpenAudioFdArgs::class.java)
        val uri = ContentUris.withAppendedId(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, args.audioId)
        val fd = try {
            activity.contentResolver.openFileDescriptor(uri, "r")?.detachFd() ?: -1
        } catch (e: Exception) {
            android.util.Log.w("AndroidMediaPlugin", "openAudioFd failed for id=${args.audioId}", e)
            -1
        }
        val ret = JSObject()
        ret.put("fd", fd)
        invoke.resolve(ret)
    }

    // -----------------------------------------------------------------------
    // Targeted MediaStore lookup (path → audio_id)
    //
    // 全件スキャンを避けるため、必要な path だけを WHERE IN (...) で問い合わせる。
    // SQLite の placeholder 上限を踏まえて 500 件ずつチャンクして送る。
    // -----------------------------------------------------------------------
    @Command
    fun audioIdsForPaths(invoke: Invoke) {
        val args = invoke.parseArgs(AudioIdsForPathsArg::class.java)
        val ids = JSObject()
        val ret = JSObject()
        if (args.paths.isEmpty()) {
            ret.put("ids", ids)
            invoke.resolve(ret)
            return
        }

        val chunkSize = 500
        args.paths.toList().chunked(chunkSize).forEach { chunk ->
            val placeholders = chunk.joinToString(",") { "?" }
            val selection = "${MediaStore.Audio.Media.DATA} IN ($placeholders)"
            try {
                activity.contentResolver.query(
                    MediaStore.Audio.Media.EXTERNAL_CONTENT_URI,
                    arrayOf(MediaStore.Audio.Media._ID, MediaStore.Audio.Media.DATA),
                    selection,
                    chunk.toTypedArray(),
                    null
                )?.use { cursor ->
                    val idIdx = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media._ID)
                    val dataIdx = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.DATA)
                    while (cursor.moveToNext()) {
                        val data = cursor.getString(dataIdx) ?: continue
                        ids.put(data, cursor.getLong(idIdx))
                    }
                }
            } catch (e: Exception) {
                android.util.Log.w("AndroidMediaPlugin", "audioIdsForPaths chunk failed", e)
            }
        }
        ret.put("ids", ids)
        invoke.resolve(ret)
    }

    private fun hashAll(fis: FileInputStream, md: MessageDigest) {
        val buf = ByteArray(64 * 1024)
        while (true) {
            val n = fis.read(buf)
            if (n <= 0) break
            md.update(buf, 0, n)
        }
    }

    private fun hashMp3Body(fis: FileInputStream, totalLen: Long, md: MessageDigest) {
        val header = ByteArray(10)
        var got = 0
        while (got < 10) {
            val n = fis.read(header, got, 10 - got)
            if (n <= 0) {
                if (got > 0) md.update(header, 0, got)
                hashAll(fis, md)
                return
            }
            got += n
        }

        var skipBytes: Long = 0
        var consumedFromHeader = 10
        if (header[0] == 'I'.code.toByte() && header[1] == 'D'.code.toByte() && header[2] == '3'.code.toByte()) {
            val flags = header[5].toInt() and 0xFF
            val sz = ((header[6].toInt() and 0x7F).toLong() shl 21) or
                ((header[7].toInt() and 0x7F).toLong() shl 14) or
                ((header[8].toInt() and 0x7F).toLong() shl 7) or
                (header[9].toInt() and 0x7F).toLong()
            val hasFooter = (flags and 0x10) != 0
            skipBytes = sz + (if (hasFooter) 10L else 0L)
        } else {
            md.update(header, 0, 10)
        }

        var remainingSkip = skipBytes
        val skipBuf = ByteArray(64 * 1024)
        while (remainingSkip > 0) {
            val want = if (remainingSkip > skipBuf.size) skipBuf.size else remainingSkip.toInt()
            val n = fis.read(skipBuf, 0, want)
            if (n <= 0) return
            remainingSkip -= n
            consumedFromHeader += n
        }

        val remainingTotal = if (totalLen >= 0) totalLen - consumedFromHeader else -1L
        if (remainingTotal == 0L) return
        if (remainingTotal < 0) {
            hashAll(fis, md)
            return
        }

        var left = remainingTotal
        val buf = ByteArray(64 * 1024)
        val tail = ByteArray(128)
        var tailLen = 0

        while (left > 0) {
            val want = if (left > buf.size) buf.size else left.toInt()
            val n = fis.read(buf, 0, want)
            if (n <= 0) break
            left -= n

            val combinedLen = tailLen + n
            if (combinedLen <= 128) {
                System.arraycopy(buf, 0, tail, tailLen, n)
                tailLen = combinedLen
            } else {
                val flushTotal = combinedLen - 128
                val flushFromTail = if (flushTotal >= tailLen) tailLen else flushTotal
                if (flushFromTail > 0) {
                    md.update(tail, 0, flushFromTail)
                }
                val remainFlush = flushTotal - flushFromTail
                if (remainFlush > 0) {
                    md.update(buf, 0, remainFlush)
                }
                val keepFromOldTail = tailLen - flushFromTail
                if (keepFromOldTail > 0) {
                    System.arraycopy(tail, flushFromTail, tail, 0, keepFromOldTail)
                }
                val keepFromBuf = n - remainFlush
                if (keepFromBuf > 0) {
                    System.arraycopy(buf, remainFlush, tail, keepFromOldTail, keepFromBuf)
                }
                tailLen = 128
            }
        }

        if (tailLen >= 3 &&
            tail[0] == 'T'.code.toByte() &&
            tail[1] == 'A'.code.toByte() &&
            tail[2] == 'G'.code.toByte()
        ) {
            // ID3v1 -> exclude
        } else {
            if (tailLen > 0) md.update(tail, 0, tailLen)
        }
    }

    private fun bytesToHex(bytes: ByteArray): String {
        val sb = StringBuilder(bytes.size * 2)
        for (b in bytes) {
            val v = b.toInt() and 0xFF
            sb.append(HEX[v ushr 4])
            sb.append(HEX[v and 0x0F])
        }
        return sb.toString()
    }

    private val HEX = "0123456789abcdef".toCharArray()

    // -----------------------------------------------------------------------
    // Playback commands (MediaController 経由で ExoPlayer を操作)
    //
    // 全コマンドで invoke.resolve(JSObject()) を使う。引数なしの resolve() は
    // Kotlin 側が文字列 "null" を返してしまい、Rust の EmptyResponse に
    // deserialize できない。
    // -----------------------------------------------------------------------

    @Command
    fun playbackSetQueue(invoke: Invoke) {
        val args = invoke.parseArgs(PlaybackSetQueueArg::class.java)
        val mediaItems = args.items.map(::toMediaItem)
        val startIndex = args.startIndex
        withController { c ->
            if (startIndex in mediaItems.indices) {
                // 完全リセット: 指定 index から再生開始
                c.setMediaItems(mediaItems, startIndex, 0L)
                c.prepare()
                c.play()
            } else {
                // startIndex == -1: 「現曲は残して、以降を置き換える」
                // 何も再生していなければ単に setMediaItems。
                val curIdx = c.currentMediaItemIndex
                val count = c.mediaItemCount
                if (curIdx == C.INDEX_UNSET || count == 0) {
                    c.setMediaItems(mediaItems)
                    c.prepare()
                } else {
                    if (count > curIdx + 1) {
                        c.removeMediaItems(curIdx + 1, count)
                    }
                    if (mediaItems.isNotEmpty()) {
                        c.addMediaItems(mediaItems)
                    }
                }
            }
            invoke.resolve(JSObject())
        }
    }

    @Command
    fun playbackEnqueue(invoke: Invoke) {
        val args = invoke.parseArgs(PlaybackEnqueueArg::class.java)
        val mi = toMediaItem(args.item)
        withController { c ->
            c.addMediaItem(mi)
            invoke.resolve(JSObject())
        }
    }

    /**
     * 既存のキューに複数アイテムを末尾追加する。
     * setQueue([first]) でまず再生開始し、その後ろに残り曲を追加する用途で使う。
     * Media3 の addMediaItems は再生中の曲に影響しない (公式に保証)。
     */
    @Command
    fun playbackAppendQueue(invoke: Invoke) {
        val args = invoke.parseArgs(PlaybackAppendQueueArg::class.java)
        val mediaItems = args.items.map(::toMediaItem)
        withController { c ->
            if (mediaItems.isNotEmpty()) {
                c.addMediaItems(mediaItems)
            }
            invoke.resolve(JSObject())
        }
    }

    @Command
    fun playbackRemoveAt(invoke: Invoke) {
        // index は「upcoming 中の index」(JS の this.queue 内の位置)。
        // native の MediaItem 配列での絶対 index = currentMediaItemIndex + 1 + upcomingIndex。
        val args = invoke.parseArgs(PlaybackIndexArg::class.java)
        withController { c ->
            val curIdx = c.currentMediaItemIndex
            val nativeIdx = if (curIdx == C.INDEX_UNSET) args.index else curIdx + 1 + args.index
            if (nativeIdx in 0 until c.mediaItemCount) {
                c.removeMediaItem(nativeIdx)
            }
            invoke.resolve(JSObject())
        }
    }

    @Command
    fun playbackMove(invoke: Invoke) {
        val args = invoke.parseArgs(PlaybackMoveArg::class.java)
        withController { c ->
            val curIdx = c.currentMediaItemIndex
            val offset = if (curIdx == C.INDEX_UNSET) 0 else curIdx + 1
            val nativeFrom = offset + args.from
            val nativeTo = offset + args.to
            val n = c.mediaItemCount
            if (nativeFrom in 0 until n && nativeTo in 0 until n) {
                c.moveMediaItem(nativeFrom, nativeTo)
            }
            invoke.resolve(JSObject())
        }
    }

    @Command
    fun playbackClear(invoke: Invoke) {
        withController { c ->
            c.clearMediaItems()
            invoke.resolve(JSObject())
        }
    }

    @Command
    fun playbackNext(invoke: Invoke) {
        withController { c ->
            if (c.hasNextMediaItem()) c.seekToNextMediaItem()
            invoke.resolve(JSObject())
        }
    }

    @Command
    fun playbackPrev(invoke: Invoke) {
        withController { c ->
            // ExoPlayer.seekToPrevious(): 3秒以上経過 → 曲頭、それ未満 → 前曲。
            c.seekToPrevious()
            invoke.resolve(JSObject())
        }
    }

    @Command
    fun playbackTogglePause(invoke: Invoke) {
        withController { c ->
            if (c.isPlaying) {
                c.pause()
            } else {
                if (c.playbackState == Player.STATE_IDLE) c.prepare()
                c.play()
            }
            invoke.resolve(JSObject())
        }
    }

    @Command
    fun playbackSeek(invoke: Invoke) {
      val args = invoke.parseArgs(PlaybackSeekArg::class.java)
        withController { c ->
            c.seekTo(args.positionMs)
            val dur = if (c.duration == C.TIME_UNSET) 0L else c.duration
            emitPosition(args.positionMs, dur, fromSeek = true)
            invoke.resolve(JSObject())
        }
    }

    @Command
    fun playbackSetVolume(invoke: Invoke) {
        val args = invoke.parseArgs(PlaybackVolumeArg::class.java)
        // master volume / 正規化 ON/OFF はサービスへ直接渡す (同一プロセス)。
        // サービス側で Player.volume(減衰) と LoudnessEnhancer(増幅) に振り分ける。
        MusicPlaybackService.setMasterVolume(args.volume)
        MusicPlaybackService.setNormalizeEnabled(args.normalize)
        invoke.resolve(JSObject())
    }

    @Command
    fun playbackSnapshot(invoke: Invoke) {
        withController { c ->
            val obj = JSObject()
            obj.put("currentIndex", c.currentMediaItemIndex)
            obj.put("isPlaying", c.isPlaying)
            obj.put("positionMs", c.currentPosition)
            obj.put("durationMs", if (c.duration == C.TIME_UNSET) 0L else c.duration)
            val tid = c.currentMediaItem?.mediaId?.toLongOrNull()
            if (tid != null) obj.put("currentTrackId", tid)
            else obj.put("currentTrackId", JSONObject.NULL)
            invoke.resolve(obj)
        }
    }
}
