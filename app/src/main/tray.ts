import { app, BrowserWindow, Menu, Tray } from 'electron'

import { getSettings, onSettingsChange, updateSettings } from './settings'
import { loadTrayIcon } from './trayIcon'
import { checkForUpdatesInteractive, getUpdateState, onUpdateStateChange, restartToInstall } from './updater'

let tray: Tray | null = null

function toggleWindow(win: BrowserWindow): void {
  if (win.isVisible() && !win.isMinimized()) {
    win.hide()
  } else {
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  }
}

/** Tray icon + context menu (Show/Hide, Always on top, Check for updates, Quit). Left-click
 *  toggles the window. */
export function createTray(getWindow: () => BrowserWindow | null): Tray {
  const icon = loadTrayIcon('tray.png', 32)
  icon.setTemplateImage(false)
  tray = new Tray(icon)
  tray.setToolTip('PlanetNavigator')

  const rebuildMenu = (): void => {
    if (!tray) return
    const win = getWindow()
    const settings = getSettings()
    const visible = !!win && win.isVisible() && !win.isMinimized()
    const update = getUpdateState()
    const menu = Menu.buildFromTemplate([
      {
        label: visible ? 'Hide' : 'Show',
        click: () => {
          const w = getWindow()
          if (w) toggleWindow(w)
        }
      },
      {
        label: 'Always on top',
        type: 'checkbox',
        checked: settings.alwaysOnTop,
        click: (item) => {
          const v = item.checked
          updateSettings({ alwaysOnTop: v })
          getWindow()?.setAlwaysOnTop(v, 'screen-saver')
        }
      },
      { type: 'separator' },
      update.downloadedVersion
        ? { label: `Restart to update to ${update.downloadedVersion}`, click: () => restartToInstall() }
        : {
            label: update.checking ? 'Checking for updates…' : 'Check for updates…',
            enabled: !update.checking,
            click: () => void checkForUpdatesInteractive()
          },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          app.isQuitting = true
          app.quit()
        }
      }
    ])
    tray.setContextMenu(menu)
  }

  tray.on('click', () => {
    const win = getWindow()
    if (win) toggleWindow(win)
  })

  const win = getWindow()
  win?.on('show', rebuildMenu)
  win?.on('hide', rebuildMenu)
  win?.on('minimize', rebuildMenu)
  win?.on('restore', rebuildMenu)
  onSettingsChange(rebuildMenu)
  onUpdateStateChange(rebuildMenu)

  rebuildMenu()
  return tray
}
