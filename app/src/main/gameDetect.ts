import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const STEAM_APP_ID = '1284190'
const GAME_DIR_NAME = 'The Planet Crafter'
const ASSEMBLY_REL_PATH = ['Planet Crafter_Data', 'Managed', 'Assembly-CSharp.dll']

/** Checked in order after the Steam registry/library scan comes up empty. */
const FALLBACK_DIRS = [
  'D:\\SteamLibrary\\steamapps\\common\\The Planet Crafter',
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\The Planet Crafter'
]

/** A valid game dir has the main assembly at `<dir>\Planet Crafter_Data\Managed\Assembly-CSharp.dll`. */
export function isValidGameDir(dir: string | null | undefined): dir is string {
  if (!dir) return false
  try {
    return existsSync(join(dir, ...ASSEMBLY_REL_PATH))
  } catch {
    return false
  }
}

async function getSteamPathFromRegistry(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('reg.exe', [
      'query',
      'HKCU\\Software\\Valve\\Steam',
      '/v',
      'SteamPath'
    ])
    const match = /SteamPath\s+REG_SZ\s+(.+)/i.exec(stdout)
    if (!match) return null
    return match[1].trim().replace(/\//g, '\\')
  } catch {
    return null
  }
}

/** Every Steam library root: the Steam install dir itself, plus every `"path"` entry in
 *  `steamapps/libraryfolders.vdf` (a hand-rolled key/value format, not real JSON/VDF-parsed). */
async function getLibraryRoots(steamPath: string): Promise<string[]> {
  const roots = new Set<string>([steamPath])
  try {
    const raw = await readFile(join(steamPath, 'steamapps', 'libraryfolders.vdf'), 'utf8')
    const re = /"path"\s*"((?:[^"\\]|\\.)*)"/gi
    let m: RegExpExecArray | null
    while ((m = re.exec(raw))) {
      roots.add(m[1].replace(/\\\\/g, '\\'))
    }
  } catch {
    // No libraryfolders.vdf (older Steam layout, or unreadable) — steamPath alone is still tried.
  }
  return [...roots]
}

async function findViaSteam(): Promise<string | null> {
  const steamPath = await getSteamPathFromRegistry()
  if (!steamPath) return null
  const roots = await getLibraryRoots(steamPath)
  for (const root of roots) {
    const manifest = join(root, 'steamapps', `appmanifest_${STEAM_APP_ID}.acf`)
    if (!existsSync(manifest)) continue
    const dir = join(root, 'steamapps', 'common', GAME_DIR_NAME)
    if (isValidGameDir(dir)) return dir
  }
  return null
}

/**
 * Resolves the game directory in order: the saved setting (if still valid), the Steam
 * registry + library scan, then a couple of hard-coded fallback paths. Returns null if none
 * of those pan out (the user can still point Settings at the folder manually).
 */
export async function detectGameDir(savedGameDir: string | null): Promise<string | null> {
  if (isValidGameDir(savedGameDir)) return savedGameDir

  const viaSteam = await findViaSteam()
  if (viaSteam) return viaSteam

  for (const dir of FALLBACK_DIRS) {
    if (isValidGameDir(dir)) return dir
  }
  return null
}
