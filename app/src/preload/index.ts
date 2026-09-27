import { contextBridge, ipcRenderer } from 'electron'

import type { CachedPoi } from '../shared/api'

// Renderer-writable subset of main/settings.ts's AppSettings (kept local instead of importing
// the sibling index.d.ts, whose module specifier resolution alongside this same-named file is
// unreliable). The renderer's real compile-time type comes from `Window.planetNav` in ./index.d.ts.
type SettingsPatch = Partial<{
  alwaysOnTop: boolean
  startMinimized: boolean
  windowOpacity: number
  scanIntervalSeconds: number
  hideStoredItems: boolean
  enabledCategories: string[]
  disabledGroups: string[]
}>

// Channel names mirror src/main/{poiStore,settings,window,installer}.ts (not imported to keep
// main-process code out of preload). The shape below must match `PlanetNavApi` in ./index.d.ts.
const planetNav = {
  version: process.env.npm_package_version ?? '0.1.0',
  loadPois: (planet: string): Promise<CachedPoi[]> => ipcRenderer.invoke('pois:load', planet),
  savePois: (planet: string, items: CachedPoi[]): Promise<void> =>
    ipcRenderer.invoke('pois:save', planet, items),
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (partial: SettingsPatch) => ipcRenderer.invoke('settings:set', partial)
  },
  setup: {
    status: () => ipcRenderer.invoke('setup:status'),
    pickGameDir: () => ipcRenderer.invoke('setup:pickGameDir'),
    installBepInEx: () => ipcRenderer.invoke('setup:installBepInEx'),
    installPlugin: () => ipcRenderer.invoke('setup:installPlugin'),
    openLogs: () => ipcRenderer.invoke('setup:openLogs')
  },
  window: {
    setAlwaysOnTop: (value: boolean) => ipcRenderer.invoke('window:setAlwaysOnTop', value)
  },
  app: {
    version: process.env.npm_package_version ?? '0.1.0'
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('planetNav', planetNav)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-expect-error (define in dts)
  window.planetNav = planetNav
}
