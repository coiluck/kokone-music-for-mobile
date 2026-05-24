import { useState, useEffect, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import {
  addScanFolder,
  addScanFolderByPath,
  hasAudioPermission,
  isAndroid,
  listAndroidAudioFolders,
  requestAudioPermission,
  runStartupScan,
} from '../lib/scanFolders'
import { ColorPicker } from '../components/ColorPicker'
import '../../css/pages/SettingsPage.css'
import { saveThemeKey, judgeBrightness, makeMildBg, ThemeSettings } from '../lib/theme'
import { useMappedTranslations } from '../lib/i18n'
import { useSettingsStore, AVAILABLE_LANGS, type HistoryBackend } from '../lib/settingsStore'
import { useScrollRestoration } from '../lib/scrollRestoration'
import { Icon } from '../components/Icon'
import Select from '../components/Select'

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
  isTrailingSilence: boolean,
  // 開発者モード
  isDeveloperMode: boolean,
  isSendHistory: boolean,
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
    // ---
    play:           'settings.play',
    masterVolume:   'settings.masterVolume',
    isNormalizeVolume: 'settings.isNormalizeVolume',
    calcLoudnessForExistingTracks: 'settings.calcLoudnessForExistingTracks',
    calcLoudnessForNewTracks: 'settings.calcLoudnessForNewTracks',
    isTrailingSilence: 'settings.isTrailingSilence',
    // ---
    isDeveloperMode: 'settings.isDeveloperMode',
    isSendHistory: 'settings.isSendHistory',
    historyBackend: 'settings.historyBackend',
    // ---
    other:          'settings.other',
    version:        'settings.version',
    github:         'settings.github',
  })
  const [folders, setFolders] = useState<string[]>([])
  const [loaded, setLoaded] = useState(false)
  const pageRef = useRef<HTMLDivElement>(null)

  // Android 用フォルダ選択モーダル
  const onAndroid = isAndroid()
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerFolders, setPickerFolders] = useState<string[]>([])
  const [pickerLoading, setPickerLoading] = useState(false)
  const [pickerNeedsPermission, setPickerNeedsPermission] = useState(false)

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
  const calcLoudnessForExistingTracks = useSettingsStore(s => s.calcLoudnessForExistingTracks)
  const setCalcLoudnessForExistingTracks = useSettingsStore(s => s.setCalcLoudnessForExistingTracks)
  const calcLoudnessForNewTracks = useSettingsStore(s => s.calcLoudnessForNewTracks)
  const setCalcLoudnessForNewTracks = useSettingsStore(s => s.setCalcLoudnessForNewTracks)
  const isTrailingSilence    = useSettingsStore(s => s.isTrailingSilence)
  const setIsTrailingSilence = useSettingsStore(s => s.setIsTrailingSilence)

  // 開発者モード設定
  const isDeveloperMode      = useSettingsStore(s => s.isDeveloperMode)
  const setIsDeveloperMode   = useSettingsStore(s => s.setIsDeveloperMode)
  const isSendHistory        = useSettingsStore(s => s.isSendHistory)
  const setIsSendHistory     = useSettingsStore(s => s.setIsSendHistory)
  const historyBackend       = useSettingsStore(s => s.historyBackend)
  const setHistoryBackend    = useSettingsStore(s => s.setHistoryBackend)
  const firebaseConfig       = useSettingsStore(s => s.firebaseConfig)
  const setFirebaseConfig    = useSettingsStore(s => s.setFirebaseConfig)
  const cloudflareD1Config   = useSettingsStore(s => s.cloudflareD1Config)
  const setCloudflareD1Config = useSettingsStore(s => s.setCloudflareD1Config)

  useEffect(() => {
    getSetting<string[]>('scan-folders', []).then(v => {
      setFolders(v)
      setLoaded(true)
    })
    getSetting('accentColor', '#ff7f7e').then(setAccentColor)
    getSetting('bgColor',     '#0a0f1e').then(setBgColor)
    getSetting('bgMildColor', '#2a2a36').then(setBgMildColor)
    getSetting('textColor',   '#f0f0f0').then(setTextColor)
    getSetting<ThemeSettings['font']>('font', 'noto-sans-ja').then(setFont)
    // icon / ignore / lang などの他ページでも使う設定は zustand ストアで管理
  }, [])

  useScrollRestoration(pageRef, { ready: loaded })

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
    if (onAndroid) {
      await openAndroidPicker()
      return
    }
    const added = await addScanFolder()
    if (added) {
      setFolders(prev => [...prev, added])
      await runStartupScan()
    }
  }

  // Android: モーダルを開いて MediaStore のフォルダ一覧を読み込む。
  // 権限がなければプロンプトを出し、ユーザー操作後に再ロードできるようにする。
  const openAndroidPicker = async () => {
    setPickerOpen(true)
    setPickerLoading(true)
    setPickerNeedsPermission(false)
    try {
      const granted = await hasAudioPermission()
      if (!granted) {
        await requestAudioPermission()
        const grantedNow = await hasAudioPermission()
        if (!grantedNow) {
          setPickerNeedsPermission(true)
          setPickerFolders([])
          return
        }
      }
      const list = await listAndroidAudioFolders()
      setPickerFolders(list)
    } finally {
      setPickerLoading(false)
    }
  }

  const reloadAndroidPicker = async () => {
    setPickerLoading(true)
    setPickerNeedsPermission(false)
    try {
      const granted = await hasAudioPermission()
      if (!granted) {
        setPickerNeedsPermission(true)
        setPickerFolders([])
        return
      }
      const list = await listAndroidAudioFolders()
      setPickerFolders(list)
    } finally {
      setPickerLoading(false)
    }
  }

  const handlePickAndroidFolder = async (path: string) => {
    const added = await addScanFolderByPath(path)
    setPickerOpen(false)
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
    <div className='page fade-in' ref={pageRef}>
      <div className='settings-container'>
        <div className='settings-section'>
          <div className='settings-section-label'>App</div>
          <div className='settings-section-content'>
            <div className='settings-section-content-item'>
              <p>{t.language}</p>
              <Select
                options={[{ value: 'en', label: 'English' }, { value: 'ja', label: '日本語 / Japanese' }]}
                value={lang}
                onChange={v => setLang(v as Lang)}
              />
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
                <Icon name="folder-plus" mode={null} size={24} folder='/images/SettingsPage/' />
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
            <div style={{ height: '1px', backgroundColor: 'rgb(from var(--color-text) r g b / 0.2)' }}></div>
            <div className='settings-section-content-item'>
              <p>{t.calcLoudnessForExistingTracks}</p>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={calcLoudnessForExistingTracks}
                  onChange={e => setCalcLoudnessForExistingTracks(e.target.checked)}
                  disabled={!isNormalizeVolume}
                />
                <span className="slider"></span>
              </label>
            </div>
            <div className='settings-section-content-item'>
              <p>{t.calcLoudnessForNewTracks}</p>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={calcLoudnessForNewTracks}
                  onChange={e => setCalcLoudnessForNewTracks(e.target.checked)}
                  disabled={!isNormalizeVolume}
                />
                <span className="slider"></span>
              </label>
            </div>
          </div>
        </div>

        {/* 開発者モード */}
        <div className='settings-section'>
          <div className='settings-section-label'>{t.isDeveloperMode}</div>
          <div className='settings-section-content'>
            <div className='settings-section-content-item'>
              <p>{t.isDeveloperMode}</p>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={isDeveloperMode}
                  onChange={e => setIsDeveloperMode(e.target.checked)}
                />
                <span className="slider"></span>
              </label>
            </div>

            {isDeveloperMode && (
              <>
                <div className='settings-section-content-item'>
                  <p>{t.isSendHistory}</p>
                  <label className="switch">
                    <input
                      type="checkbox"
                      checked={isSendHistory}
                      onChange={e => setIsSendHistory(e.target.checked)}
                    />
                    <span className="slider"></span>
                  </label>
                </div>

                <div className='settings-section-content-item' style={{ opacity: isSendHistory ? 1 : 0.4 }}>
                  <p>{t.historyBackend}</p>
                  <Select
                    options={[{ value: 'firebase', label: 'Firebase' }, { value: 'cloudflare-d1', label: 'Cloudflare D1' }]}
                    value={historyBackend}
                    onChange={v => setHistoryBackend(v as HistoryBackend)}
                    disabled={!isSendHistory}
                  />
                </div>

                {isSendHistory && historyBackend === 'firebase' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    <div className='settings-section-content-item'>
                      <p>Project ID</p>
                      <input
                        type="text"
                        value={firebaseConfig.projectId}
                        placeholder="my-firebase-project"
                        onChange={e => setFirebaseConfig({ ...firebaseConfig, projectId: e.target.value })}
                      />
                    </div>
                    <div className='settings-section-content-item'>
                      <p>API Key</p>
                      <input
                        type="password"
                        value={firebaseConfig.apiKey}
                        placeholder="AIza..."
                        onChange={e => setFirebaseConfig({ ...firebaseConfig, apiKey: e.target.value })}
                      />
                    </div>
                    <div className='settings-section-content-item'>
                      <p>Collection</p>
                      <input
                        type="text"
                        value={firebaseConfig.collection}
                        placeholder="play_history"
                        onChange={e => setFirebaseConfig({ ...firebaseConfig, collection: e.target.value })}
                      />
                    </div>
                  </div>
                )}

                {isSendHistory && historyBackend === 'cloudflare-d1' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem'}}>
                    <div className='settings-section-content-item'>
                      <p>Endpoint URL</p>
                      <input
                        type="text"
                        value={cloudflareD1Config.endpoint}
                        placeholder="https://your-worker.workers.dev/history"
                        onChange={e => setCloudflareD1Config({ ...cloudflareD1Config, endpoint: e.target.value })}
                      />
                    </div>
                    <div className='settings-section-content-item'>
                      <p>API Token</p>
                      <input
                        type="password"
                        value={cloudflareD1Config.apiToken}
                        placeholder="(optional) Bearer token"
                        onChange={e => setCloudflareD1Config({ ...cloudflareD1Config, apiToken: e.target.value })}
                      />
                    </div>
                  </div>
                )}
              </>
            )}
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

      {pickerOpen && (
        <div className='settings-folder-picker-overlay' onClick={() => setPickerOpen(false)}>
          <div className='settings-folder-picker' onClick={e => e.stopPropagation()}>
            <div className='settings-folder-picker-header'>
              <span>{t.addFolder}</span>
              <span
                className='settings-folder-picker-close'
                onClick={() => setPickerOpen(false)}
              >
                ×
              </span>
            </div>

            <div className='settings-folder-picker-body'>
              {pickerLoading && (
                <p style={{ opacity: 0.7 }}>{lang === 'ja' ? '読み込み中...' : 'Loading...'}</p>
              )}

              {!pickerLoading && pickerNeedsPermission && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <p>{lang === 'ja'
                    ? '音楽ファイルへのアクセス権限が必要です。許可後にもう一度押してください。'
                    : 'Audio access permission is required. Tap again after granting it.'}</p>
                  <div
                    className='settings-folder-scan'
                    onClick={async () => {
                      await requestAudioPermission()
                      await reloadAndroidPicker()
                    }}
                  >
                    {lang === 'ja' ? 'アクセスを許可 / 再読込' : 'Grant access / Reload'}
                  </div>
                </div>
              )}

              {!pickerLoading && !pickerNeedsPermission && pickerFolders.length === 0 && (
                <p style={{ opacity: 0.7 }}>
                  {lang === 'ja' ? 'フォルダが見つかりませんでした。' : 'No folders found.'}
                </p>
              )}

              {!pickerLoading && !pickerNeedsPermission && pickerFolders.length > 0 && (
                <div className='settings-folder-picker-list'>
                  {pickerFolders.map(p => {
                    const already = folders.includes(p)
                    return (
                      <div
                        key={p}
                        className={`settings-folder-picker-item${already ? ' disabled' : ''}`}
                        onClick={() => { if (!already) handlePickAndroidFolder(p) }}
                      >
                        <div className='settings-folder-picker-item-icon'>
                          <Icon name="folder" mode={iconStyle} size={20} folder='/images/SettingsPage/' />
                        </div>
                        <div className='settings-folder-picker-item-info'>
                          <span className='settings-folder-name'>{getFolderName(p)}</span>
                          <span className='settings-folder-path'>{p}</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}