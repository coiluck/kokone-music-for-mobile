import { useState, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { addScanFolder, runStartupScan } from '../lib/scanFolders'
import { ColorPicker } from '../components/ColorPicker'
import '../../css/pages/SettingsPage.css'
import { saveThemeKey, judgeBrightness, makeMildBg, ThemeSettings } from '../lib/theme'
import { useMappedTranslations } from '../lib/i18n'
import { useSettingsStore, AVAILABLE_LANGS } from '../lib/settingsStore'
import { Icon } from '../components/Icon'

export interface SettingsStore {
  // 外観
  bgColor: string,
  bgMildColor: string,
  accentColor: string,
  textColor: string,
  iconStyle: 'fill' | 'outline',
  font: 'mamelon' | 'm-plus-rounded' | 'noto-sans-ja' | 'noto-serif'
  // スキャンフォルダ
  scanFolder: string[], // folder path
  ignoreMode: boolean,
  ignoreTime: number, // seconds
  // 音楽
  masterVolume: number, // 0 to 2
  isNormalizeVolume: boolean,
  crossSettings: 'normal' | 'cross_fade',
  fadeTime: number, // ms, 0 to 2
  isTrailingSilence: boolean,
}

type Lang = typeof AVAILABLE_LANGS[number]

const backgroundColorsPreset = [
  '#fff3f1', '#cce6e5', '#ccccea', '#0a0f1e', '#1e1e1e'
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
    app: 'settings.app',
    language: 'settings.language',
    appearance: 'settings.appearance',
    accentColor: 'settings.accentColor',
    background:     'settings.background',
    icon:           'settings.icon',
    font:           'settings.font',
    scanFolder:     'settings.scanFolder',
    addFolder:      'settings.addFolder',
    ignoreMode:     'settings.ignoreMode',
    ignoreTime:     'settings.ignoreTime',
    scanNow:        'settings.scanNow',
    play:           'settings.play',
    masterVolume:   'settings.masterVolume',
    isNormalizeVolume: 'settings.isNormalizeVolume',
    crossSettings:  'settings.crossSettings',
    crossNomal:     'settings.crossSettings.nomal',
    crossCross:     'settings.crossSettings.crossFade',
    fadeTime:       'settings.fadeTime',
    isTrailingSilence: 'settings.isTrailingSilence',
    other:          'settings.other',
    version:        'settings.version',
    github:         'settings.github',
  })
  const [folders, setFolders] = useState<string[]>([])

  const [accentColor, setAccentColor] = useState('#ff7f7e')
  const [bgColor,     setBgColor]     = useState('#0a0f1e')
  const [bgMildColor, setBgMildColor] = useState('#2a2a36')
  const [textColor,   setTextColor]   = useState('#f0f0f0')
  const [font, setFont] = useState<ThemeSettings['font']>('noto-sans-ja')

  // iconStyle・ignoreMode・ignoreTime は zustand ストアで管理
  const iconStyle      = useSettingsStore(s => s.iconStyle)
  const setIconStyle   = useSettingsStore(s => s.setIconStyle)
  const ignoreMode     = useSettingsStore(s => s.ignoreMode)
  const ignoreTime     = useSettingsStore(s => s.ignoreTime)
  const setIgnoreMode  = useSettingsStore(s => s.setIgnoreMode)
  const setIgnoreTime  = useSettingsStore(s => s.setIgnoreTime)
  const lang           = useSettingsStore(s => s.lang)
  const setLang        = useSettingsStore(s => s.setLang)

  // 再生設定
  const masterVolume         = useSettingsStore(s => s.masterVolume)
  const setMasterVolume      = useSettingsStore(s => s.setMasterVolume)
  const isNormalizeVolume    = useSettingsStore(s => s.isNormalizeVolume)
  const setIsNormalizeVolume = useSettingsStore(s => s.setIsNormalizeVolume)
  const crossfadeMode        = useSettingsStore(s => s.crossfadeMode)
  const setCrossfadeMode     = useSettingsStore(s => s.setCrossfadeMode)
  const fadeoutMs            = useSettingsStore(s => s.fadeoutMs)
  const setFadeoutMs         = useSettingsStore(s => s.setFadeoutMs)
  const isTrailingSilence    = useSettingsStore(s => s.isTrailingSilence)
  const setIsTrailingSilence = useSettingsStore(s => s.setIsTrailingSilence)

  useEffect(() => {
    getSetting('scan-folders', []).then(setFolders)
    getSetting('accentColor', '#ff7f7e').then(setAccentColor)
    getSetting('bgColor',     '#0a0f1e').then(setBgColor)
    getSetting('bgMildColor', '#2a2a36').then(setBgMildColor)
    getSetting('textColor',   '#f0f0f0').then(setTextColor)
    getSetting<ThemeSettings['font']>('font', 'noto-sans-ja').then(setFont)
    // icon / ignore / lang などの他ページでも使う設定は zustand ストアで管理
  }, [])

  const handleColorChange = async <K extends 'accentColor' | 'bgColor' | 'bgMildColor' | 'textColor'>(
    key: K,
    value: string,
    setter: (v: string) => void,
  ) => {
    setter(value)
    await saveThemeKey(key, value)
  }
  const handleFontChange = async (value: ThemeSettings['font']) => {
    setFont(value)
    await saveThemeKey('font', value)
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

  const getFolderName = (path: string) => {
    const parts = path.replace(/[/\\]+$/, '').split(/[/\\]+/)
    return parts[parts.length - 1] || path
  }

  return (
    <div className='page fade-in'>
      <div className='settings-container'>
        <div className='settings-section'>
          <div className='settings-section-label'>App</div>
          <div className='settings-section-content'>
            <div className='settings-section-content-item'>
              <p>{t.language}</p>
              <select value={lang} onChange={e => setLang(e.target.value as Lang)}>
                <option value="ja">日本語 / Japanese</option>
                <option value="en">English</option>
              </select>
            </div>
          </div>
        </div>

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
            <div className='settings-section-content-item'>
              <p>{t.icon}</p>
              <div className="settings-icon-style">
                <div
                  className={`settings-icon-item${iconStyle === 'outline' ? ' active' : ''}`}
                  onClick={() => setIconStyle('outline')}
                >
                  <div className="settings-icon outline" />
                </div>
                <div
                  className={`settings-icon-item${iconStyle === 'fill' ? ' active' : ''}`}
                  onClick={() => setIconStyle('fill')}
                >
                  <div className="settings-icon fill" />
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className='settings-section'>
          <div className='settings-section-label'>{t.font}</div>
          <div className='settings-font-item-container'>
            <div
              className={`settings-font-item${font === 'mamelon' ? ' active' : ''}`}
              onClick={() => handleFontChange('mamelon')}
              style={{ borderBottom: '1px dashed rgb(from var(--color-text) r g b / 0.2)' }}
            >
              <span className='settings-font-item-text' style={{ fontFamily: 'Mamelon' }}>Mamelon</span>
            </div>
            <div
              className={`settings-font-item${font === 'm-plus-rounded' ? ' active' : ''}`}
              onClick={() => handleFontChange('m-plus-rounded')}
              style={{ borderBottom: '1px dashed rgb(from var(--color-text) r g b / 0.2)' }}
            >
              <span className='settings-font-item-text' style={{ fontFamily: 'M-PLUS-Rounded-1c' }}>M PLUS Rounded 1c</span>
            </div>
            <div
              className={`settings-font-item${font === 'noto-sans-ja' ? ' active' : ''}`}
              onClick={() => handleFontChange('noto-sans-ja')}
              style={{ borderBottom: '1px dashed rgb(from var(--color-text) r g b / 0.2)' }}
            >
              <span className='settings-font-item-text' style={{ fontFamily: 'Noto-Sans-JP' }}>Noto Sans JP</span>
            </div>
            <div
              className={`settings-font-item${font === 'noto-serif' ? ' active' : ''}`}
              onClick={() => handleFontChange('noto-serif')}
            >
              <span className='settings-font-item-text' style={{ fontFamily: 'Noto-Serif-JP' }}>Noto Serif JP</span>
            </div>
          </div>
        </div>

        <div className='settings-section'>
          <div className='settings-section-label'>{t.scanFolder}</div>
          <div className='settings-section-content'>
            <div className='settings-folder-add-container' onClick={handleAddFolder}>
              <span className='settings-folder-add-text'>{t.addFolder}</span>
              <span className='settings-folder-add-icon'>
                <Icon name="folder-plus" mode={iconStyle} size={24} folder='/images/SettingsPage/' />
              </span>
            </div>
            <div className='settings-folder-container'>
              {folders.map(f => (
                <div key={f} className="settings-folder-item">
                  <div className="settings-folder-item-icon">
                    <Icon name="folder" mode={iconStyle} size={24} folder='/images/SettingsPage/' />
                  </div>
                  <div className="settings-folder-item-info">
                    <span className="settings-folder-name">{getFolderName(f)}</span>
                    <span className="settings-folder-path">{f}</span>
                  </div>
                  <div onClick={() => handleRemoveFolder(f)}>
                    <Icon name="remove" mode={iconStyle} size={24} folder='/images/SettingsPage/' />
                  </div>
                </div>
              ))}
            </div>

            {/* ignoreMode トグル */}
            <div className='settings-section-content-item'>
              <p>{t.ignoreMode}</p>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={ignoreMode}
                  onChange={e => setIgnoreMode(e.target.checked)}
                />
                <span className="slider"></span>
              </label>
            </div>

            <div className='settings-section-content-item' style={{ opacity: ignoreMode ? 1 : 0.4 }}>
              <input
                className='settings-range-slider'
                type="range"
                min="0"
                max="30"
                step="5"
                value={ignoreTime}
                disabled={!ignoreMode}
                onChange={e => setIgnoreTime(Number(e.target.value))}
              />
              <p className='settings-range-value'>{ignoreTime}{t.ignoreTime}</p>
            </div>

            <div className='settings-folder-scan' onClick={runStartupScan}>{t.scanNow}</div>
          </div>
        </div>


        <div className='settings-section'>
          <div className='settings-section-label'>{t.play}</div>
          <div className='settings-section-content'>
            <div className='settings-section-content-item'>
              <p>{t.masterVolume}</p>
              <div style={{ display: 'flex', flexDirection: 'row', gap: 10, alignItems: 'center' }}>
                <input
                  className='settings-range-slider settings-range-container'
                  type="range"
                  min="0"
                  max="2"
                  step="0.1"
                  value={masterVolume}
                  onChange={e => setMasterVolume(Number(e.target.value))}
                />
                <span className='settings-range-value'>{masterVolume.toFixed(1)}</span>
              </div>
            </div>
            <div className='settings-section-content-item'>
              <p>{t.isNormalizeVolume}</p>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={isNormalizeVolume}
                  onChange={e => setIsNormalizeVolume(e.target.checked)}
                />
                <span className="slider"></span>
              </label>
            </div>
            <div className='settings-section-content-item'>
              <p>{t.crossSettings}</p>
              <select
                value={crossfadeMode}
                onChange={e => setCrossfadeMode(e.target.value as 'normal' | 'cross_fade')}
              >
                <option value="normal">{t.crossNomal}</option>
                <option value="cross_fade">{t.crossCross}</option>
              </select>
            </div>
            <div className='settings-section-content-item'>
              <p>{t.fadeTime}</p>
              <div style={{ display: 'flex', flexDirection: 'row', gap: 10, alignItems: 'center' }}>
                <input
                  className='settings-range-slider settings-range-container'
                  type="range"
                  min="0"
                   max="2000"
                  step="100"
                  value={fadeoutMs}
                  onChange={e => setFadeoutMs(Number(e.target.value))}
                />
              <span className='settings-range-value'>{fadeoutMs}ms</span>
              </div>
            </div>
            <div className='settings-section-content-item'>
              <p>{t.isTrailingSilence}</p>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={isTrailingSilence}
                  onChange={e => setIsTrailingSilence(e.target.checked)}
                />
                <span className="slider"></span>
              </label>
            </div>
          </div>
        </div>

        <div className='settings-section'>
          <div className='settings-section-label'>{t.other}</div>
          <div className='settings-section-content'>
            <div className='settings-section-content-item'>
              <p>{t.version}</p>
              <span className='settings-range-value'>{__APP_VERSION__}</span>
            </div>
            <div className='settings-section-content-item'>
              <p>{t.github}</p>
              <span className='settings-range-value'>
                <a href='https://github.com/coiluck/kokone-music-for-mobile' target='_blank' rel='noopener noreferrer' style={{ display: 'flex', flexDirection: 'row', gap: 5, alignItems: 'center' }}>
                  kokone-music-for-mobile
                  <Icon name="external" mode={null} size={10} folder='/images/SettingsPage/' />
                </a>
              </span>
            </div>
          </div>
        </div>

      </div>

      <p
        style={{marginTop: 15, fontSize: '.7rem', textAlign: 'center'}}
      >
        Developed by KOKONE Project
      </p>
    </div>
  )
}