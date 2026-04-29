package moe.coiluck.kokone_music.androidmedia

import android.Manifest
import android.app.Activity
import android.content.ContentUris
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.provider.MediaStore
import androidx.core.content.ContextCompat
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.Permission
import app.tauri.annotation.PermissionCallback
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSArray
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.FileInputStream
import java.security.MessageDigest

@InvokeArg
class AudioHashArgs {
    var audioId: Long = 0
    var isMp3: Boolean = false
}

@TauriPlugin(
    permissions = [
        Permission(strings = [Manifest.permission.READ_MEDIA_AUDIO], alias = "audio33"),
        Permission(strings = [Manifest.permission.READ_EXTERNAL_STORAGE], alias = "audio"),
    ]
)
class AndroidMediaPlugin(private val activity: Activity) : Plugin(activity) {

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

                    // 既存DBのpathカラムとの整合性のため、displayPath決定ロジックは
                    // 旧 MediaStoreHelper.kt と完全に同一にする:
                    //   1. MediaStore.Audio.Media.DATA が取れていればそれを使う
                    //   2. 取れない場合は "/storage/emulated/0/" + RELATIVE_PATH + DISPLAY_NAME
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

    private fun hashAll(fis: FileInputStream, md: MessageDigest) {
        val buf = ByteArray(64 * 1024)
        while (true) {
            val n = fis.read(buf)
            if (n <= 0) break
            md.update(buf, 0, n)
        }
    }

    // mp3 の音声本体のみハッシュ。先頭 ID3v2 と末尾 ID3v1 (TAG) を除外する。
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
}
