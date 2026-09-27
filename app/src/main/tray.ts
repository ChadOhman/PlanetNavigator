import { app, BrowserWindow, Menu, Tray } from 'electron'

import { getSettings, onSettingsChange, updateSettings } from './settings'
import { loadTrayIcon } from './trayIcon'

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

/** Tray icon + context menu (Show/Hide, Always on top, Quit). Left-click toggles the window. */
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

  rebuildMenu()
  return tray
}
