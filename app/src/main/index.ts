import { app, BrowserWindow } from 'electron'

// Ambient augmentation for `app.isQuitting` (picked up automatically via tsconfig's include glob).
import type {} from './electron-augment'
import { registerSetupIpc } from './installer'
import { registerPoiStoreIpc } from './poiStore'
import { loadSettings, registerSettingsIpc } from './settings'
import { createTray } from './tray'
import { initAutoUpdater } from './updater'
import { createMainWindow, registerWindowIpc } from './window'

let mainWindow: BrowserWindow | null = null

app.whenReady().then(async () => {
  await loadSettings()

  registerPoiStoreIpc()
  registerSettingsIpc()

  mainWindow = createMainWindow()
  registerWindowIpc(() => mainWindow)
  registerSetupIpc(() => mainWindow)
  createTray(() => mainWindow)
  initAutoUpdater(() => mainWindow)

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow()
    }
  })
})

app.on('before-quit', () => {
  app.isQuitting = true
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
