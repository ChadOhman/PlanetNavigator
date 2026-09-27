import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app, BrowserWindow, ipcMain, screen } from 'electron'

import { getSettings, onSettingsChange, updateSettings, type WindowBounds } from './settings'

const MIN_WIDTH = 640
const MIN_HEIGHT = 480
const BOUNDS_SAVE_DEBOUNCE_MS = 400

export const IPC_WINDOW_SET_ALWAYS_ON_TOP = 'window:setAlwaysOnTop'

/** Saved bounds are only restored when they still land on a connected display (monitor
 *  unplugged, resolution changed, etc. would otherwise put the window off-screen). */
function boundsOnScreen(b: WindowBounds): boolean {
  return screen.getAllDisplays().some((d) => {
    const a = d.workArea
    return b.x < a.x + a.width && b.x + b.width > a.x && b.y < a.y + a.height && b.y + b.height > a.y
  })
}

/** In dev, the packaged .exe icon isn't available, so point at the generated PNG directly.
 *  Packaged builds already get their icon baked into the exe by electron-builder (win.icon),
 *  but passing the same path is harmless as a fallback when the file happens to be present. */
function resolveWindowIconPath(): string | undefined {
  const iconPath = join(app.getAppPath(), 'build', 'icon.png')
  return existsSync(iconPath) ? iconPath : undefined
}

export function createMainWindow(): BrowserWindow {
  const settings = getSettings()
  const bounds = settings.windowBounds && boundsOnScreen(settings.windowBounds) ? settings.windowBounds : null

  const win = new BrowserWindow({
    width: bounds?.width ?? 1100,
    height: bounds?.height ?? 800,
    x: bounds?.x,
    y: bounds?.y,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    title: 'PlanetNavigator',
    backgroundColor: '#1b1f24',
    icon: resolveWindowIconPath(),
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: false
    }
  })

  // 'screen-saver' keeps the window above a borderless-windowed game, which plain always-on-top
  // levels typically don't.
  win.setAlwaysOnTop(settings.alwaysOnTop, 'screen-saver')
  win.setOpacity(settings.windowOpacity)

  const unsubscribeSettings = onSettingsChange((s) => {
    if (win.isDestroyed()) return
    win.setAlwaysOnTop(s.alwaysOnTop, 'screen-saver')
    win.setOpacity(s.windowOpacity)
  })

  let boundsTimer: NodeJS.Timeout | undefined
  const persistBounds = (): void => {
    if (win.isDestroyed() || win.isMinimized() || win.isMaximized() || win.isFullScreen()) return
    if (boundsTimer) clearTimeout(boundsTimer)
    boundsTimer = setTimeout(() => {
      const b = win.getBounds()
      updateSettings({ windowBounds: { x: b.x, y: b.y, width: b.width, height: b.height } })
    }, BOUNDS_SAVE_DEBOUNCE_MS)
  }
  win.on('move', persistBounds)
  win.on('resize', persistBounds)

  // Hide to tray instead of quitting; the tray's Quit item sets app.isQuitting first.
  win.on('close', (ev) => {
    if (app.isQuitting) return
    ev.preventDefault()
    win.hide()
  })

  win.on('closed', () => {
    if (boundsTimer) clearTimeout(boundsTimer)
    unsubscribeSettings()
  })

  win.once('ready-to-show', () => {
    if (!getSettings().startMinimized) win.show()
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

export function registerWindowIpc(getWindow: () => BrowserWindow | null): void {
  ipcMain.handle(IPC_WINDOW_SET_ALWAYS_ON_TOP, (_event, value: unknown) => {
    const v = Boolean(value)
    updateSettings({ alwaysOnTop: v })
    getWindow()?.setAlwaysOnTop(v, 'screen-saver')
    return v
  })
}
