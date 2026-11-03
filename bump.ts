// アプリのバージョンを一括で書き換える
// 使い方: pnpm bump 1.4.1
//
// @types/node を入れずに済むよう、使う分だけ型をここで宣言する。
// fs は import せず process.getBuiltinModule (Node 22.3+) で取る
declare const process: {
  argv: string[]
  exit(code: number): never
  getBuiltinModule(id: 'node:fs'): {
    readFileSync(path: URL, encoding: 'utf8'): string
    writeFileSync(path: URL, data: string): void
  }
}
const { readFileSync, writeFileSync } = process.getBuiltinModule('node:fs')

const next = process.argv[2]
if (!next || !/^\d+\.\d+\.\d+$/.test(next)) {
  console.error('usage: pnpm bump <major.minor.patch>')
  process.exit(1)
}

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

const current: string = JSON.parse(read('package.json')).version
const crateName = read('src-tauri/Cargo.toml').match(/^name = "([^"]+)"/m)?.[1]

// 各ファイルでアプリ自身のバージョンだけを指す正規表現。2 番目のグループがバージョン
const targets: [string, RegExp][] = [
  ['package.json',              /^(  "version": ")([^"]+)(")/m],
  ['src-tauri/tauri.conf.json', /^(  "version": ")([^"]+)(")/m],
  ['src-tauri/Cargo.toml',      /^(\[package\]\nname = "[^"]+"\nversion = ")([^"]+)(")/m],
  ['src-tauri/Cargo.lock',      new RegExp(`^(\\[\\[package\\]\\]\\nname = "${crateName}"\\nversion = ")([^"]+)(")`, 'm')],
]

// 全ファイルを確認してから書き込む。1 つでも食い違えば何も書かない
const updates = targets.map(([path, re]) => {
  const text = read(path)
  const found = text.match(re)?.[2]
  if (found !== current) {
    console.error(`${path}: expected ${current}, found ${found ?? 'no version'}`)
    process.exit(1)
  }
  return [path, text.replace(re, `$1${next}$3`)] as const
})

for (const [path, text] of updates) {
  writeFileSync(new URL(path, import.meta.url), text)
  console.log(`${path}: ${current} -> ${next}`)
}
