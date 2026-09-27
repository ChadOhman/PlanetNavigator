import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app, ipcMain } from 'electron'

import type { CachedPoi } from '../shared/api'

export const IPC_LOAD_POIS = 'pois:load'
export const IPC_SAVE_POIS = 'pois:save'

const PLANET_ID = /^[A-Za-z0-9_-]{1,64}$/

function poiDir(): string {
  return join(app.getPath('userData'), 'pois')
}

function poiFile(planet: string): string {
  if (!PLANET_ID.test(planet)) throw new Error(`Invalid planet id: ${planet}`)
  return join(poiDir(), `${planet}.json`)
}

export async function loadPois(planet: string): Promise<CachedPoi[]> {
  try {
    const raw = await readFile(poiFile(planet), 'utf8')
    const data = JSON.parse(raw) as unknown
    return Array.isArray(data) ? (data as CachedPoi[]) : []
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn(`[poiStore] failed to load ${planet}:`, err)
    }
    return []
  }
}

export async function savePois(planet: string, items: CachedPoi[]): Promise<void> {
  if (!Array.isArray(items)) throw new Error('items must be an array')
  const file = poiFile(planet)
  await mkdir(poiDir(), { recursive: true })
  const tmp = `${file}.tmp`
  await writeFile(tmp, JSON.stringify(items), 'utf8')
  await rename(tmp, file)
}

export function registerPoiStoreIpc(): void {
  ipcMain.handle(IPC_LOAD_POIS, (_event, planet: string) => loadPois(String(planet)))
  ipcMain.handle(IPC_SAVE_POIS, (_event, planet: string, items: CachedPoi[]) =>
    savePois(String(planet), items)
  )
}
