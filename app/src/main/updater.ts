import { app, BrowserWindow, dialog } from 'electron'
import { autoUpdater, type UpdateInfo } from 'electron-updater'

// Auto-update via electron-updater against the GitHub Releases feed configured in
// electron-builder.yml (`publish`). Only active in packaged builds: `npm run dev` and
// `electron-vite preview` have no app-update.yml and would just log errors.
//
// Flow: a quiet check runs shortly after startup and every few hours. Updates download in the
// background; once downloaded the user is asked to restart (or the update installs on the next
// quit). The tray offers a manual "Check for updates…" with explicit feedback.

const STARTUP_DELAY_MS = 10_000
const PERIODIC_INTERVAL_MS = 4 * 60 * 60 * 1000

export interface UpdateState {
  /** Version that has been downloaded and is waiting for a restart, if any. */
  downloadedVersion: string | null
  checking: boolean
}

type GetWindow = () => BrowserWindow | null

let getWindow: GetWindow = () => null
let downloaded: UpdateInfo | null = null
let checking = false
/** Version the automatic flow has already prompted for, so periodic checks don't nag. */
let promptedVersion: string | null = null
const listeners = new Set<(state: UpdateState) => void>()

export function isUpdateSupported(): boolean {
  return app.isPackaged
}

export function getUpdateState(): UpdateState {
  return { downloadedVersion: downloaded?.version ?? null, checking }
}

export function onUpdateStateChange(fn: (state: UpdateState) => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function notify(): void {
  const state = getUpdateState()
  for (const fn of listeners) fn(state)
}

function setChecking(v: boolean): void {
  if (checking === v) return
  checking = v
  notify()
}

/** Parent for dialogs: only a visible window, so a hide-to-tray state doesn't orphan the box. */
function dialogParent(): BrowserWindow | undefined {
  const win = getWindow()
  return win && !win.isDestroyed() && win.isVisible() ? win : undefined
}

function showMessage(options: Electron.MessageBoxOptions): Promise<Electron.MessageBoxReturnValue> {
  const parent = dialogParent()
  return parent ? dialog.showMessageBox(parent, options) : dialog.showMessageBox(options)
}

export function restartToInstall(): void {
  if (!downloaded) return
  app.isQuitting = true
  // Silent NSIS install, relaunch when done.
  autoUpdater.quitAndInstall(true, true)
}

async function promptRestart(info: UpdateInfo): Promise<void> {
  const { response } = await showMessage({
    type: 'info',
    title: 'Update ready',
    message: `PlanetNavigator ${info.version} is ready to install.`,
    detail:
      `You are running ${app.getVersion()}. Restart now to update, or keep working and the update ` +
      'will install the next time you quit.',
    buttons: ['Restart now', 'Later'],
    defaultId: 0,
    cancelId: 1,
    noLink: true
  })
  if (response === 0) restartToInstall()
}

/** Background check: silent on "no update" and on errors (offline, rate limit, ...). */
async function checkQuietly(): Promise<void> {
  if (checking || downloaded) return
  setChecking(true)
  try {
    await autoUpdater.checkForUpdates()
  } catch (err) {
    console.warn('[updater] background check failed:', err)
  } finally {
    setChecking(false)
  }
}

/** Tray "Check for updates…": always reports an outcome to the user. */
export async function checkForUpdatesInteractive(): Promise<void> {
  if (!isUpdateSupported()) {
    await showMessage({
      type: 'info',
      title: 'Updates unavailable',
      message: 'Automatic updates only work in the installed app, not when running from source.'
    })
    return
  }
  if (downloaded) {
    await promptRestart(downloaded)
    return
  }
  if (checking) return
  setChecking(true)
  try {
    const result = await autoUpdater.checkForUpdates()
    if (!result || !result.isUpdateAvailable) {
      await showMessage({
        type: 'info',
        title: 'Up to date',
        message: `PlanetNavigator ${app.getVersion()} is the latest version.`
      })
      return
    }
    // autoDownload is on, so the download started; `update-downloaded` will prompt for restart.
    await showMessage({
      type: 'info',
      title: 'Update available',
      message: `Downloading PlanetNavigator ${result.updateInfo.version}…`,
      detail: 'You will be asked to restart once the download finishes.'
    })
  } catch (err) {
    console.warn('[updater] manual check failed:', err)
    await showMessage({
      type: 'error',
      title: 'Update check failed',
      message: 'Could not check for updates.',
      detail: err instanceof Error ? err.message : String(err)
    })
  } finally {
    setChecking(false)
  }
}

export function initAutoUpdater(getWin: GetWindow): void {
  getWindow = getWin
  if (!isUpdateSupported()) {
    console.info('[updater] not packaged; auto-update disabled')
    return
  }

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.logger = {
    info: (m: unknown) => console.info('[updater]', m),
    warn: (m: unknown) => console.warn('[updater]', m),
    error: (m: unknown) => console.error('[updater]', m),
    debug: () => {}
  }

  autoUpdater.on('update-downloaded', (info) => {
    downloaded = info
    notify()
    // The manual path prompts on its own; only prompt once per version for automatic checks.
    if (promptedVersion === info.version) return
    promptedVersion = info.version
    void promptRestart(info)
  })
  autoUpdater.on('error', (err) => {
    console.warn('[updater] error:', err)
  })

  setTimeout(() => void checkQuietly(), STARTUP_DELAY_MS).unref()
  setInterval(() => void checkQuietly(), PERIODIC_INTERVAL_MS).unref()
}
