import { useState, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { addScanFolder, runStartupScan } from '../lib/scanFolders'
import { ColorPicker } from '../components/ColorPicker'
import '../../css/pages/SettingsPage.css'

export interface SettingsStore {
  // 外観
  bgColor: string,
  bgMildColor: string,
  accentColor: string,
  textColor: string,
  iconStyle: 'fill' | 'line',
  font: 'mamelon' | 'm-plus-rounded' | 'noto-sans-ja' | 'noto-serif'
  page: string[]
  // 音楽
  musicVolume: number, // 0 to 2
  fadeTime: number, // ms, 0 to 2
  scanFolder: string[], // folder path
  isTrailingSilence: boolean,
  isNormalizeVolume: boolean,
}
const backgroundColorsPreset = [
  '#fff3f1', '#cce6e5', '#888', '#0a0f1e', '#1e1e1e'
]
const primaryColorsPreset = [
  '#ff7f7e', '#37D67A',
  '#2CCCE4', '#dce775', '#e565ff',
]

export default function SettingsPage() {
  const [folders, setFolders] = useState<string[]>([])

  useEffect(() => {
    // 現在の設定済みフォルダ一覧を表示
    invoke<string[]>('settings_get', { key: 'scan-folders' })
      .then(f => setFolders(f ?? []))
  }, [])

  const handleAddFolder = async () => {
    const added = await addScanFolder()
    if (added) {
      setFolders(prev => [...prev, added])
      await runStartupScan()
    }
  }

  const handleRemoveFolder = async (path: string) => {
    const updated = folders.filter(f => f !== path)
    await invoke('settings_set', { key: 'scan-folders', value: updated })
    setFolders(updated)
  }

  return (
    <div className='page fade-in'>
      <div className='settings-container'>
        <div className='settings-section'>
          <div className='settings-section-label'>外観</div>
          <div className='settings-section-content'>
            <ColorPicker
              color="#ff7f7e"
              onChange={v => console.log(v)}
              label="color"
              presetColors={primaryColorsPreset}
            />
            <ColorPicker
              color="#1e1e28"
              onChange={v => console.log(v)}
              label="bg"
              presetColors={backgroundColorsPreset}
            />
          </div>
        </div>
      </div>
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