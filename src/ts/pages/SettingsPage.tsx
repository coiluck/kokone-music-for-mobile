import { useState, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { addScanFolder, runStartupScan } from '../lib/scanFolders'
import { ColorPicker } from '../components/ColorPicker'
import '../../css/pages/SettingsPage.css'
import { saveThemeKey, judgeBrightness, makeMildBg } from '../lib/theme'
import { useMappedTranslations } from '../lib/i18n'

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
  '#fff3f1', '#cce6e5', '#aaaabc', '#0a0f1e', '#1e1e1e'
]
const primaryColorsPreset = [
  '#ff7f7e', '#37D67A',
  '#2CCCE4', '#dce775', '#e565ff',
]

async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const v = await invoke<T | null>('settings_get', { key })
  return v ?? fallback
}

export default function SettingsPage() {
  const t = useMappedTranslations({
    appearance: 'settings.appearance',
    accentColor: 'settings.accentColor',
    background: 'settings.background',
    icon: 'settings.icon',
    font: 'settings.font',
  })
  const [folders, setFolders] = useState<string[]>([])

  const [accentColor, setAccentColor] = useState('#ff7f7e')
  const [bgColor,     setBgColor]     = useState('#0a0f1e')
  const [bgMildColor, setBgMildColor] = useState('#2a2a36')
  const [textColor,   setTextColor]   = useState('#f0f0f0')

  useEffect(() => {
    // 設定を取得 & 反映
    getSetting('scan-folders', []).then(setFolders)
    getSetting('accentColor', '#ff7f7e').then(setAccentColor)
    getSetting('bgColor',     '#0a0f1e').then(setBgColor)
    getSetting('bgMildColor', '#2a2a36').then(setBgMildColor)
    getSetting('textColor',   '#f0f0f0').then(setTextColor)
  }, [])

  const handleColorChange = async <K extends 'accentColor' | 'bgColor' | 'bgMildColor' | 'textColor'>(
    key: K,
    value: string,
    setter: (v: string) => void,
  ) => {
    setter(value)
    await saveThemeKey(key, value)
  }

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
          <div className='settings-section-label'>{t.appearance}</div>
          <div className='settings-section-content'>
            <ColorPicker
              color={accentColor}
              onChange={v => handleColorChange('accentColor', v, setAccentColor)}
              label={t.accentColor}
              presetColors={primaryColorsPreset}
            />
            <ColorPicker
              color={bgColor}
              onChange={v => {
                const mild = makeMildBg(v, judgeBrightness(v) ? 'darker' : 'lighter')
                const text = judgeBrightness(v) ? '#000' : '#fff'
                setBgColor(v)
                setBgMildColor(mild)
                setTextColor(text)
                saveThemeKey('bgColor', v)
                saveThemeKey('bgMildColor', mild)
                saveThemeKey('textColor', text)
              }}
              label={t.background}
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