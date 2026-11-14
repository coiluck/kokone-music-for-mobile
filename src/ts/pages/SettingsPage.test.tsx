// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSettingsStore } from '../lib/settingsStore'
import SettingsPage from './SettingsPage'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn().mockResolvedValue(null) }))
vi.mock('../lib/i18n', () => ({
  useMappedTranslations: (mapping: Record<string, string>) => mapping,
}))
vi.mock('../lib/scanFolders', () => ({ getScanFolders: vi.fn().mockResolvedValue([]) }))
vi.mock('../lib/scan', () => ({ runStartupScan: vi.fn() }))
vi.mock('../lib/platform', () => ({ isAndroid: () => false }))
vi.mock('../components/HeaderSub', () => ({ default: () => null }))
vi.mock('../components/ColorPicker', () => ({ ColorPicker: () => null }))

vi.stubGlobal('__APP_VERSION__', '0.0.0')

// ラベルの行にあるスイッチ
function switchOf(label: string) {
  const item = screen.getByText(label).closest<HTMLElement>('.settings-section-content-item')!
  return { item, input: item.querySelector<HTMLInputElement>('input[type="checkbox"]')! }
}

async function renderPage() {
  render(<MemoryRouter><SettingsPage /></MemoryRouter>)
  await screen.findByText('settings.isDeveloperMode', { selector: 'p' })
}

beforeEach(() => {
  useSettingsStore.setState({
    isDeveloperMode: true,
    isNormalizeVolume: true,
    disableAnalysingLoudness: false,
    isAutoTagging: true,
  })
})

afterEach(cleanup)

describe('開発者モードの解析設定', () => {
  it('音量の解析を無効化すると、自動タグ付は値を保ったままグレーアウトする', async () => {
    await renderPage()
    expect(switchOf('settings.isAutoTagging').input.disabled).toBe(false)
    expect(switchOf('settings.isAutoTagging').item.style.opacity).toBe('1')

    fireEvent.click(switchOf('settings.disableAnalysingLoudness').input)

    const { item, input } = switchOf('settings.isAutoTagging')
    expect(input.disabled).toBe(true)
    expect(item.style.opacity).toBe('0.4')
    expect(input.checked).toBe(true)
    expect(useSettingsStore.getState().isAutoTagging).toBe(true)
  })

  it('音量の正規化が OFF でも、音量の解析の無効化は切り替えられる', async () => {
    useSettingsStore.setState({ isNormalizeVolume: false })
    await renderPage()

    const { input } = switchOf('settings.disableAnalysingLoudness')
    expect(input.disabled).toBe(false)
    fireEvent.click(input)
    expect(useSettingsStore.getState().disableAnalysingLoudness).toBe(true)
  })

  it('開発者モードが OFF なら解析設定を表示しない', async () => {
    useSettingsStore.setState({ isDeveloperMode: false })
    await renderPage()

    expect(screen.queryByText('settings.isAutoTagging')).toBeNull()
    expect(screen.queryByText('settings.disableAnalysingLoudness')).toBeNull()
  })
})
