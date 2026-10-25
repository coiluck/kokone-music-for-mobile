import React from 'react'
import ReactDOM from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import { router } from './router'
import { initDb } from './lib/db'
import { runStartupScan } from './lib/scanFolders'
import { loadAndApplyTheme } from './lib/theme'
import { useSettingsStore } from './lib/settingsStore'
import { useTrackStore } from './lib/trackStore'
import { useScanStore } from './lib/scanStore'
import { listen } from '@tauri-apps/api/event'

async function bootstrap() {
  await loadAndApplyTheme()

  await Promise.all([
    initDb(),
    useSettingsStore.getState().loadIconSettings(),
    useSettingsStore.getState().loadScanIgnoreSettings(),
    useSettingsStore.getState().loadLang(),
    useSettingsStore.getState().loadPlaySettings(),
    useSettingsStore.getState().loadDeveloperSettings(),
  ])

  // trackStore を初期 hydrate（initDb 後）
  await useTrackStore.getState().hydrate()

  // scan 完了時 (scanVersion 増分) に再 hydrate する
  useScanStore.subscribe((state, prev) => {
    if (state.scanVersion !== prev.scanVersion) {
      void useTrackStore.getState().hydrate()
    }
  })
  // 曲調タグはスキャン完了後にバックグラウンドで付くので、付け終わったら読み直す
  void listen('tone-analyze-completed', () => useScanStore.getState().notifyScanCompleted())

  runStartupScan()
}

bootstrap().then(() => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <RouterProvider router={router} />
    </React.StrictMode>
  )
})