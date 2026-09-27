import { execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'

import { detectGameDir, isValidGameDir } from './gameDetect'
import { getSettings, updateSettings } from './settings'

const execFileAsync = promisify(execFile)

export const IPC_SETUP_STATUS = 'setup:status'
export const IPC_SETUP_PICK_GAME_DIR = 'setup:pickGameDir'
export const IPC_SETUP_INSTALL_BEPINEX = 'setup:installBepInEx'
export const IPC_SETUP_INSTALL_PLUGIN = 'setup:installPlugin'
export const IPC_SETUP_OPEN_LOGS = 'setup:openLogs'

const BEPINEX_VERSION = '5.4.23.5'
const BEPINEX_URL = `https://github.com/BepInEx/BepInEx/releases/download/v${BEPINEX_VERSION}/BepInEx_win_x64_${BEPINEX_VERSION}.zip`
const BEPINEX_EXPECTED_SIZE = 639_118
const GAME_PROCESS_NAME = 'Planet Crafter.exe'
const GAME_RUNNING_CACHE_MS = 5000

export interface SetupStatus {
  gameDir: string | null
  gameFound: boolean
  bepinexInstalled: boolean
  pluginInstalled: boolean
  pluginUpToDate: boolean
  bundledPluginPath: string
  gameRunning: boolean
}

export interface InstallResult {
  ok: boolean
  message: string
}

export interface PickGameDirResult {
  ok: boolean
  message?: string
  gameDir?: string
}

function pluginDir(gameDir: string): string {
  return join(gameDir, 'BepInEx', 'plugins', 'PlanetNavigator')
}

function installedPluginPath(gameDir: string): string {
  return join(pluginDir(gameDir), 'PlanetNavigator.dll')
}

/** The DLL the app ships with: `resources/mod/...` in dev, `<resourcesPath>/mod/...` packaged
 *  (see electron-builder.yml's `extraResources`). */
export function bundledPluginPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'mod', 'PlanetNavigator.dll')
    : join(app.getAppPath(), 'resources', 'mod', 'PlanetNavigator.dll')
}

export function bepinexLogPath(gameDir: string): string {
  return join(gameDir, 'BepInEx', 'LogOutput.log')
}

async function sha256File(path: string): Promise<string> {
  const buf = await readFile(path)
  return createHash('sha256').update(buf).digest('hex')
}

let gameRunningCache: { at: number; running: boolean } | null = null

async function isGameRunning(): Promise<boolean> {
  const now = Date.now()
  if (gameRunningCache && now - gameRunningCache.at < GAME_RUNNING_CACHE_MS) {
    return gameRunningCache.running
  }
  let running = false
  try {
    const { stdout } = await execFileAsync('tasklist.exe', [
      '/FI',
      `IMAGENAME eq ${GAME_PROCESS_NAME}`,
      '/NH'
    ])
    running = stdout.toLowerCase().includes(GAME_PROCESS_NAME.toLowerCase())
  } catch {
    running = false
  }
  gameRunningCache = { at: now, running }
  return running
}

export async function getSetupStatus(gameDir: string | null): Promise<SetupStatus> {
  const gameFound = isValidGameDir(gameDir)
  const bundled = bundledPluginPath()

  let bepinexInstalled = false
  let pluginInstalled = false
  let pluginUpToDate = false

  if (gameFound && gameDir) {
    bepinexInstalled =
      existsSync(join(gameDir, 'BepInEx', 'core', 'BepInEx.dll')) && existsSync(join(gameDir, 'winhttp.dll'))
    const installedPath = installedPluginPath(gameDir)
    pluginInstalled = existsSync(installedPath)
    if (pluginInstalled && existsSync(bundled)) {
      try {
        const [installedHash, bundledHash] = await Promise.all([
          sha256File(installedPath),
          sha256File(bundled)
        ])
        pluginUpToDate = installedHash === bundledHash
      } catch {
        pluginUpToDate = false
      }
    }
  }

  return {
    gameDir,
    gameFound,
    bepinexInstalled,
    pluginInstalled,
    pluginUpToDate,
    bundledPluginPath: bundled,
    gameRunning: await isGameRunning()
  }
}

function runExpandArchive(zipPath: string, destDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const escape = (s: string): string => s.replace(/'/g, "''")
    const command = `Expand-Archive -LiteralPath '${escape(zipPath)}' -DestinationPath '${escape(destDir)}' -Force`
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command],
      { windowsHide: true }
    )
    let stderr = ''
    child.stderr?.on('data', (d: Buffer) => {
      stderr += d.toString()
    })
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`Expand-Archive exited with code ${code}: ${stderr.trim() || '(no output)'}`))
    })
  })
}

/** Downloads and extracts BepInEx into `gameDir`. Refuses while the game is running. Never
 *  requests elevation — the game folder must already be user-writable. */
export async function installBepInEx(gameDir: string): Promise<InstallResult> {
  if (!isValidGameDir(gameDir)) return { ok: false, message: 'Game folder not found.' }
  if (await isGameRunning()) return { ok: false, message: 'Close the game before installing BepInEx.' }

  const tmpDir = await mkdtemp(join(tmpdir(), 'planetnav-bepinex-'))
  const zipPath = join(tmpDir, `BepInEx_win_x64_${BEPINEX_VERSION}.zip`)
  try {
    let res: Response
    try {
      res = await fetch(BEPINEX_URL)
    } catch (err) {
      return { ok: false, message: `Download failed: ${err instanceof Error ? err.message : String(err)}` }
    }
    if (!res.ok) return { ok: false, message: `Download failed (HTTP ${res.status}).` }

    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length !== BEPINEX_EXPECTED_SIZE) {
      return {
        ok: false,
        message: `Downloaded file size mismatch (expected ${BEPINEX_EXPECTED_SIZE} bytes, got ${buf.length}). Try again.`
      }
    }
    await writeFile(zipPath, buf)
    await runExpandArchive(zipPath, gameDir)

    return {
      ok: true,
      message: 'BepInEx installed. Install the plugin next, then launch the game once.'
    }
  } catch (err) {
    return { ok: false, message: `Install failed: ${err instanceof Error ? err.message : String(err)}` }
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => undefined)
  }
}

/** Copies the bundled plugin DLL into `BepInEx/plugins/PlanetNavigator/`. Refuses while the
 *  game is running (the DLL is loaded and locked). */
export async function installPlugin(gameDir: string): Promise<InstallResult> {
  if (!isValidGameDir(gameDir)) return { ok: false, message: 'Game folder not found.' }
  if (await isGameRunning()) return { ok: false, message: 'Close the game before installing the plugin.' }

  const bundled = bundledPluginPath()
  if (!existsSync(bundled)) return { ok: false, message: `Bundled plugin not found at ${bundled}.` }

  try {
    const dir = pluginDir(gameDir)
    await mkdir(dir, { recursive: true })
    await copyFile(bundled, installedPluginPath(gameDir))
    return { ok: true, message: 'Plugin installed. Launch (or restart) the game to connect.' }
  } catch (err) {
    return { ok: false, message: `Install failed: ${err instanceof Error ? err.message : String(err)}` }
  }
}

export function registerSetupIpc(getWindow: () => BrowserWindow | null): void {
  ipcMain.handle(IPC_SETUP_STATUS, async () => {
    const settings = getSettings()
    const gameDir = await detectGameDir(settings.gameDir)
    if (gameDir && gameDir !== settings.gameDir) updateSettings({ gameDir })
    return getSetupStatus(gameDir)
  })

  ipcMain.handle(IPC_SETUP_PICK_GAME_DIR, async (): Promise<PickGameDirResult> => {
    const win = getWindow()
    const result = win
      ? await dialog.showOpenDialog(win, {
          title: 'Select The Planet Crafter folder',
          properties: ['openDirectory']
        })
      : await dialog.showOpenDialog({
          title: 'Select The Planet Crafter folder',
          properties: ['openDirectory']
        })

    if (result.canceled || !result.filePaths[0]) return { ok: false, message: 'Cancelled.' }
    const dir = result.filePaths[0]
    if (!isValidGameDir(dir)) {
      return {
        ok: false,
        message:
          'That folder does not look like The Planet Crafter (missing Planet Crafter_Data\\Managed\\Assembly-CSharp.dll).'
      }
    }
    updateSettings({ gameDir: dir })
    return { ok: true, gameDir: dir }
  })

  ipcMain.handle(IPC_SETUP_INSTALL_BEPINEX, async (): Promise<InstallResult> => {
    const gameDir = getSettings().gameDir
    if (!isValidGameDir(gameDir)) return { ok: false, message: 'No valid game folder set.' }
    return installBepInEx(gameDir)
  })

  ipcMain.handle(IPC_SETUP_INSTALL_PLUGIN, async (): Promise<InstallResult> => {
    const gameDir = getSettings().gameDir
    if (!isValidGameDir(gameDir)) return { ok: false, message: 'No valid game folder set.' }
    return installPlugin(gameDir)
  })

  ipcMain.handle(IPC_SETUP_OPEN_LOGS, (): InstallResult => {
    const gameDir = getSettings().gameDir
    if (!isValidGameDir(gameDir)) return { ok: false, message: 'No valid game folder set.' }
    const logPath = bepinexLogPath(gameDir)
    if (!existsSync(logPath)) return { ok: false, message: 'No log file yet — launch the game first.' }
    shell.showItemInFolder(logPath)
    return { ok: true, message: 'Opened.' }
  })
}
