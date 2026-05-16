import React from 'react'
import ReactDOM from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import { router } from './router'
import { initDb } from './lib/db'
import { runStartupScan } from './lib/scanFolders'
import { loadAndApplyTheme } from './lib/theme'
import { useSettingsStore } from './lib/settingsStore'

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

  runStartupScan()
}

bootstrap().then(() => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <RouterProvider router={router} />
    </React.StrictMode>
  )
})