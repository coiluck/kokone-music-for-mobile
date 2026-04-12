import { useState, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { addScanFolder, runStartupScan } from '../lib/scanFolders'

export default function SettingsPage() {
  const [folders, setFolders] = useState<string[]>([])

  useEffect(() => {
    // 現在の設定済みフォルダ一覧を表示
    invoke<string[]>('settings_get', { key: 'scan-folders' })
      .then(f => setFolders(f ?? []))
  }, [])

  const handleAddFolder = async () => {
    const added = await addScanFolder()  // ★ダイアログ → 設定保存
    if (added) {
      setFolders(prev => [...prev, added])
      await runStartupScan()             // ★追加直後にスキャン実行
    }
  }

  const handleRemoveFolder = async (path: string) => {
    const updated = folders.filter(f => f !== path)
    await invoke('settings_set', { key: 'scan-folders', value: updated })
    setFolders(updated)
  }

  return (
    <div>
      <h2>スキャンフォルダ</h2>
      <ul>
        {folders.map(f => (
          <li key={f}>
            {f}
            <button onClick={() => handleRemoveFolder(f)}>削除</button>
          </li>
        ))}
      </ul>
      <button onClick={handleAddFolder}>＋ フォルダを追加</button>
      <button onClick={runStartupScan}>今すぐ再スキャン</button>
    </div>
  )
}