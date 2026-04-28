package moe.coiluck.kokone_music

import android.app.Activity
import android.content.ContentUris
import android.content.Context
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.MediaStore
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import java.io.FileInputStream
import java.security.MessageDigest

// Rust(JNI) から呼び出される MediaStore アクセスのヘルパー。
// Tauri のフルプラグインは作らず、static メソッドだけを公開して
// android_media.rs から直接 call_static_method する。
//
// scoped storage 対応のため、Rust 側はファイルパスから直接ファイルを開かない。
// 代わりに Kotlin が ContentResolver 経由で読み出した結果を返す。
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

    // ---------------------------------------------------------------------
    // Audio 列挙
    // ---------------------------------------------------------------------

    // MediaStore から取得した1曲分のメタデータ。
    // Rust 側 (android_media.rs) で扱いやすいよう、TSV1行にまとめて文字列で返す。
    // フィールド: id, displayPath, displayName, title, artist, album, durationMs, sizeBytes
    //   - displayPath: 表示用に使う絶対パス相当の文字列。
    //                  RELATIVE_PATH + DISPLAY_NAME から組み立てる。
    //                  scoped storage 後でも安定して取れる「論理パス」。
    //                  scan-folder のフィルタリングと、ユーザーへの表示に使う。
    //   - 区切りは TAB (\t)、各値内のタブ・改行は空白に置換する。
    //
    // 旧 API (queryAudioFiles → 絶対パスのみ) は scoped storage 下では
    // 直接 fopen できない場合があり、Rust 側で lofty::Probe::open 等が
    // EACCES で失敗してスキャンが止まる原因になる。
    // 必要なメタデータをここで全部詰めて返すことで、
    // Rust 側のファイル直接 open を不要にする。
    @JvmStatic
    fun queryAudioMetadata(context: Context): Array<String> {
        if (!hasAudioPermission(context)) return emptyArray()

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
            MediaStore.Audio.Media.DATA, // 互換性のため取得を試みる (取れない/null なら relativePath で代替)
        )
        val selection = "${MediaStore.Audio.Media.IS_MUSIC} != 0"

        val out = ArrayList<String>()
        try {
            context.contentResolver.query(uri, projection, selection, null, null)?.use { cursor ->
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

                    // displayPath の決定:
                    //   1) MediaStore.Audio.Media.DATA (絶対パス) が取れていればそれを使う。
                    //      Android 9 以前は確実に取れる。Android 10+ も大抵は取れる
                    //      (deprecated だが値自体は返る)。
                    //   2) 取れない場合は "/storage/emulated/0/" + RELATIVE_PATH + DISPLAY_NAME
                    //      で擬似的な絶対パスを組み立てる。これは scan-folder マッチングと
                    //      画面表示にしか使わず、ファイル open には使わない。
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

                    val line = listOf(
                        id.toString(),
                        sanitize(displayPath),
                        sanitize(displayName),
                        sanitize(title),
                        sanitize(artist),
                        sanitize(album),
                        durationMs.toString(),
                        sizeBytes.toString(),
                    ).joinToString("\t")
                    out.add(line)
                }
            }
        } catch (e: Exception) {
            android.util.Log.w("MediaStoreHelper", "queryAudioMetadata failed", e)
            return emptyArray()
        }
        return out.toTypedArray()
    }

    // 旧 API: 互換性のため残すが、内部は queryAudioMetadata から displayPath だけ抜き出して返す。
    // (android_media.rs の query_audio_files から呼ばれる可能性がある場合のためのフォールバック)
    @JvmStatic
    fun queryAudioFiles(context: Context): Array<String> {
        val rows = queryAudioMetadata(context)
        return rows.mapNotNull { row ->
            val cols = row.split('\t')
            if (cols.size >= 2) cols[1] else null
        }.toTypedArray()
    }

    // ---------------------------------------------------------------------
    // ハッシュ計算 (Rust から直接 fopen できないため Kotlin 側で行う)
    // ---------------------------------------------------------------------

    // 指定された Audio ID のファイル内容を ContentResolver 経由で読み、SHA-256 を返す。
    // mp3 の場合は ID3v2 ヘッダ末尾以降〜ID3v1 直前までの音声本体のみハッシュする
    // (Rust 側 mp3_audio_hash と互換性を持たせる)。
    // それ以外はファイル全体をハッシュする (Rust 側 file_hash と互換)。
    // 失敗したら空文字を返す。
    @JvmStatic
    fun audioHash(context: Context, audioId: Long, isMp3: Boolean): String {
        val uri = ContentUris.withAppendedId(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, audioId)
        return try {
            context.contentResolver.openFileDescriptor(uri, "r")?.use { pfd ->
                FileInputStream(pfd.fileDescriptor).use { fis ->
                    val md = MessageDigest.getInstance("SHA-256")
                    val totalLen = pfd.statSize.takeIf { it >= 0 } ?: -1L

                    if (isMp3 && totalLen >= 10) {
                        hashMp3Body(fis, totalLen, md)
                    } else {
                        hashAll(fis, md)
                    }
                    bytesToHex(md.digest())
                } ?: ""
            } ?: ""
        } catch (e: Exception) {
            android.util.Log.w("MediaStoreHelper", "audioHash failed for id=$audioId", e)
            ""
        }
    }

    private fun hashAll(fis: FileInputStream, md: MessageDigest) {
        val buf = ByteArray(64 * 1024)
        while (true) {
            val n = fis.read(buf)
            if (n <= 0) break
            md.update(buf, 0, n)
        }
    }

    // mp3 の音声本体のみハッシュ。
    // FileInputStream は openFileDescriptor 由来なので skip / available の挙動が
    // 必ずしも信頼できない。先頭は read で読み、必要分だけ md.update する。
    // 末尾 ID3v1 (TAG) は最後の128バイトを除外することで対応する
    // (= 全体長 - 128 までしかハッシュしない、ただし末尾128バイトに TAG が無ければ含める)。
    private fun hashMp3Body(fis: FileInputStream, totalLen: Long, md: MessageDigest) {
        // --- 先頭10バイトを読んで ID3v2 を判定 ---
        val header = ByteArray(10)
        var got = 0
        while (got < 10) {
            val n = fis.read(header, got, 10 - got)
            if (n <= 0) {
                // 10バイト無い → 全部ハッシュして終わり
                if (got > 0) md.update(header, 0, got)
                hashAll(fis, md)
                return
            }
            got += n
        }

        var skipBytes: Long = 0
        var consumedFromHeader = 10 // 既にreadした量
        if (header[0] == 'I'.code.toByte() && header[1] == 'D'.code.toByte() && header[2] == '3'.code.toByte()) {
            val flags = header[5].toInt() and 0xFF
            val sz = ((header[6].toInt() and 0x7F).toLong() shl 21) or
                ((header[7].toInt() and 0x7F).toLong() shl 14) or
                ((header[8].toInt() and 0x7F).toLong() shl 7) or
                (header[9].toInt() and 0x7F).toLong()
            val hasFooter = (flags and 0x10) != 0
            // ID3v2 全体は 10 + sz (+10 if footer) バイト。先頭から飛ばす。
            skipBytes = sz + (if (hasFooter) 10L else 0L)
            // header の10バイトはハッシュに含めず破棄する。
        } else {
            // ID3v2 ではない → 先頭10バイトもハッシュ対象
            md.update(header, 0, 10)
        }

        // --- ID3v2 領域を skip ---
        var remainingSkip = skipBytes
        val skipBuf = ByteArray(64 * 1024)
        while (remainingSkip > 0) {
            val want = if (remainingSkip > skipBuf.size) skipBuf.size else remainingSkip.toInt()
            val n = fis.read(skipBuf, 0, want)
            if (n <= 0) return
            remainingSkip -= n
            consumedFromHeader += n
        }

        // --- 残り = totalLen - consumedFromHeader バイトをハッシュ。
        //     末尾128バイトの "TAG" を除外するため、いったん全部読んで末尾を捨てるのではなく、
        //     残量を逐次計算しながら最後の128バイトを保留する方式にする。
        val remainingTotal = if (totalLen >= 0) totalLen - consumedFromHeader else -1L
        if (remainingTotal == 0L) return

        if (remainingTotal < 0) {
            // statSize が取れなかった → 末尾 TAG を考慮せず全部ハッシュ
            hashAll(fis, md)
            return
        }

        var left = remainingTotal
        // 末尾128バイトを除外するため、残量 > 128 の間だけ md.update する。
        val buf = ByteArray(64 * 1024)
        // 末尾128バイトをためておくリングバッファ
        val tail = ByteArray(128)
        var tailLen = 0

        while (left > 0) {
            val want = if (left > buf.size) buf.size else left.toInt()
            val n = fis.read(buf, 0, want)
            if (n <= 0) break
            left -= n

            // tail を含めて、末尾128バイトを保留しつつ前の分を md.update に流す。
            // 「これまでの tail (tailLen バイト) + 今回読んだ buf[0..n)」のうち
            // 末尾128を新しい tail にし、残りを md.update する。
            val combinedLen = tailLen + n
            if (combinedLen <= 128) {
                // まだ全部 tail に入る
                System.arraycopy(buf, 0, tail, tailLen, n)
                tailLen = combinedLen
            } else {
                // tail から流す分: combinedLen - 128
                val flushTotal = combinedLen - 128
                // まず tail から流す
                val flushFromTail = if (flushTotal >= tailLen) tailLen else flushTotal
                if (flushFromTail > 0) {
                    md.update(tail, 0, flushFromTail)
                }
                val remainFlush = flushTotal - flushFromTail
                // buf から流す
                if (remainFlush > 0) {
                    md.update(buf, 0, remainFlush)
                }
                // 新しい tail を作る:
                //   旧 tail のうち流してない部分 = tailLen - flushFromTail バイト
                //   buf のうち流してない部分     = n - remainFlush バイト
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

        // 末尾 tail (最大128バイト) のうち、"TAG" 始まりなら ID3v1 として除外、
        // そうでなければハッシュに含める。
        if (tailLen >= 3 &&
            tail[0] == 'T'.code.toByte() &&
            tail[1] == 'A'.code.toByte() &&
            tail[2] == 'G'.code.toByte()
        ) {
            // 除外
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

    // 値内のタブ・改行を空白に置換する (TSV を壊さないため)。
    private fun sanitize(s: String): String {
        if (s.isEmpty()) return s
        val sb = StringBuilder(s.length)
        for (c in s) {
            sb.append(if (c == '\t' || c == '\n' || c == '\r') ' ' else c)
        }
        return sb.toString()
    }
}