"""明暗 (明 / 淡 / 暗) のラベルをブラウザで付ける。標準ライブラリだけで動く。

使い方:
  python label.py <曲フォルダ> [ポート]
ブラウザで http://localhost:8765 を開き、曲を聴いて 明 / 淡 / 暗 を押す (キー 1 / 2 / 3)。
押すたびに labels/mood3_labels.json へ保存する。形式は [{"id": 曲フォルダからの相対パス, "level": "明"|"淡"|"暗"}]。
以前の 2 段階のラベル (labels/mood_labels.json) とエネルギーのラベルは参考として一覧に表示する。
"""
import json
import sys
import unicodedata
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

LEVELS = ["明", "淡", "暗"]
LABELS = Path(__file__).parent / "labels"
OUT = LABELS / "mood3_labels.json"


def nfc(s):
    return unicodedata.normalize("NFC", s)


def read_labels(name):
    p = LABELS / name
    return {nfc(r["id"]): r["level"] for r in json.loads(p.read_text(encoding="utf-8"))} if p.exists() else {}


music = Path(sys.argv[1])
# id は tone_dump と同じ (曲フォルダからの相対パス、区切りは /)
files = {nfc(p.relative_to(music).as_posix()): p for p in music.rglob("*") if p.is_file() and p.suffix.lower() == ".mp3"}
old, energy, current = read_labels("mood_labels.json"), read_labels("energy_labels.json"), read_labels(OUT.name)
# 以前ラベルを付けた曲を先に並べる
order = sorted(files, key=lambda i: (i not in old, i))

PAGE = """<!doctype html><meta charset="utf-8"><title>明暗ラベル</title>
<style>
body{margin:0;font:14px sans-serif;display:flex;height:100vh;background:#181818;color:#ddd}
#list{width:420px;overflow:auto;border-right:1px solid #333}
#list div{padding:4px 8px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#list div.cur{background:#335}
#list b{display:inline-block;width:1.4em}
small{color:#888;margin-left:6px}
#main{flex:1;padding:24px}
audio{width:100%;margin:16px 0}
button{font-size:28px;padding:16px 36px;margin-right:12px;cursor:pointer}
button.on{outline:4px solid #6cf}
</style>
<div id="list"></div>
<div id="main">
  <div id="count"></div>
  <label><input type="checkbox" id="todo"> 未ラベルだけ表示</label>
  <h2 id="title"></h2>
  <audio id="audio" controls autoplay></audio>
  <div id="buttons"></div>
  <p><button id="clear" style="font-size:14px;padding:6px 12px">ラベルを消す</button></p>
  <p>キー: 1 明 / 2 淡 / 3 暗 / ← → 10 秒移動 / ↑ ↓ 前後の曲 / Space 再生・停止<br>
  ラベルを付けると次の未ラベルの曲へ進む。</p>
</div>
<script>
const LEVELS = ["明", "淡", "暗"]
let tracks = [], cur = -1
const $ = id => document.getElementById(id)
const audio = $("audio")

function render() {
  $("count").textContent = `${tracks.filter(t => t.level).length} / ${tracks.length} 曲`
  $("list").innerHTML = ""
  tracks.forEach((t, i) => {
    if ($("todo").checked && t.level && i !== cur) return
    const d = document.createElement("div")
    d.className = i === cur ? "cur" : ""
    d.innerHTML = `<b>${t.level || "・"}</b>`
    d.append(t.id)
    const s = document.createElement("small")
    s.textContent = [t.old && "旧" + t.old, t.energy && "エネルギー" + t.energy].filter(Boolean).join(" ")
    d.append(s)
    d.onclick = () => select(i)
    $("list").append(d)
  })
  document.querySelectorAll("#buttons button").forEach(b => b.className = cur >= 0 && tracks[cur].level === b.textContent ? "on" : "")
  document.querySelector("#list .cur")?.scrollIntoView({block: "nearest"})
}

function select(i) {
  if (i < 0 || i >= tracks.length) return
  cur = i
  $("title").textContent = tracks[i].id
  audio.src = "/audio?id=" + encodeURIComponent(tracks[i].id)
  render()
}

async function label(level) {
  if (cur < 0) return
  const t = tracks[cur]
  const res = await fetch("/api/label", {method: "POST", body: JSON.stringify({id: t.id, level})})
  if (!res.ok) return alert("保存に失敗しました")
  t.level = level
  const next = level ? tracks.findIndex((x, i) => i > cur && !x.level) : -1
  next >= 0 ? select(next) : render()
}

LEVELS.forEach(l => {
  const b = document.createElement("button")
  b.textContent = l
  b.onclick = () => label(l)
  $("buttons").append(b)
})
$("clear").onclick = () => label(null)
$("todo").onchange = render
document.onkeydown = e => {
  const k = e.key
  if (k >= "1" && k <= "3") label(LEVELS[k - 1])
  else if (k === "ArrowRight") audio.currentTime += 10
  else if (k === "ArrowLeft") audio.currentTime -= 10
  else if (k === "ArrowDown") select(cur + 1)
  else if (k === "ArrowUp") select(cur - 1)
  else if (k === " ") audio.paused ? audio.play() : audio.pause()
  else return
  e.preventDefault()
}
fetch("/api/tracks").then(r => r.json()).then(t => {
  tracks = t
  const first = tracks.findIndex(x => !x.level)
  select(first >= 0 ? first : 0)
})
</script>
"""


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def send(self, status, body=b"", ctype="application/json", headers=()):
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        for k, v in headers:
            self.send_header(k, v)
        self.end_headers()
        try:
            self.wfile.write(body)
        except ConnectionError:
            pass  # 曲を切り替えるとブラウザが音声の読み込みを途中で打ち切る

    def do_GET(self):
        url = urlparse(self.path)
        if url.path == "/":
            self.send(200, PAGE.encode("utf-8"), "text/html; charset=utf-8")
        elif url.path == "/api/tracks":
            rows = [{"id": i, "level": current.get(i), "old": old.get(i), "energy": energy.get(i)} for i in order]
            self.send(200, json.dumps(rows, ensure_ascii=False).encode("utf-8"))
        elif url.path == "/audio":
            path = files.get(parse_qs(url.query).get("id", [""])[0])
            if path is None:
                return self.send(404)
            data = path.read_bytes()
            # シークできるよう Range に応える
            rng = self.headers.get("Range", "")
            if rng.startswith("bytes="):
                a, _, b = rng[6:].partition("-")
                start = int(a) if a else max(len(data) - int(b), 0)
                end = min(int(b), len(data) - 1) if a and b else len(data) - 1
                self.send(206, data[start:end + 1], "audio/mpeg",
                          [("Content-Range", f"bytes {start}-{end}/{len(data)}"), ("Accept-Ranges", "bytes")])
            else:
                self.send(200, data, "audio/mpeg", [("Accept-Ranges", "bytes")])
        else:
            self.send(404)

    def do_POST(self):
        if self.path != "/api/label":
            return self.send(404)
        req = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        if req["id"] not in files or req["level"] not in LEVELS + [None]:
            return self.send(400)
        if req["level"] is None:
            current.pop(req["id"], None)
        else:
            current[req["id"]] = req["level"]
        LABELS.mkdir(exist_ok=True)
        rows = [{"id": i, "level": l} for i, l in sorted(current.items())]
        OUT.write_text(json.dumps(rows, ensure_ascii=False, indent=1), encoding="utf-8")
        self.send(200, b"{}")


if __name__ == "__main__":
    port = int(sys.argv[2]) if len(sys.argv) > 2 else 8765
    print(f"{len(files)} 曲 (ラベル済み {len(current)})  http://localhost:{port}  終了は Ctrl+C")
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
