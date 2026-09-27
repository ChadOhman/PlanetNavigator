import type { CachedPoi } from '../shared/api'

export interface WindowBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface AppSettings {
  alwaysOnTop: boolean
  startMinimized: boolean
  /** 0.4..1.0 */
  windowOpacity: number
  gameDir: string | null
  port: number
  scanIntervalSeconds: number
  /** Hide POIs held by/inside a storage or furniture on the map and nearby list. */
  hideStoredItems: boolean
  /** POI categories shown on the map/list. Defaults to the app's `DEFAULT_ENABLED_CATEGORIES`
   *  when absent. */
  enabledCategories: string[]
  /** Per-group opt-out inside an otherwise-enabled category. */
  disabledGroups: string[]
  windowBounds?: WindowBounds
}

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

export interface PlanetNavApi {
  version: string
  /** Reads userData/pois/<planet>.json; resolves to [] when missing. */
  loadPois(planet: string): Promise<CachedPoi[]>
  /** Writes userData/pois/<planet>.json atomically. */
  savePois(planet: string, items: CachedPoi[]): Promise<void>
  settings: {
    get(): Promise<AppSettings>
    /** Only alwaysOnTop/startMinimized/windowOpacity/scanIntervalSeconds/hideStoredItems/
     *  enabledCategories/disabledGroups are renderer-writable; gameDir and windowBounds are
     *  ignored here (see setup.pickGameDir and window bounds). */
    set(partial: Partial<AppSettings>): Promise<AppSettings>
  }
  setup: {
    /** Re-detects the game dir (if needed) and reports install state. */
    status(): Promise<SetupStatus>
    /** Opens a folder picker; validates and persists the chosen dir on success. */
    pickGameDir(): Promise<PickGameDirResult>
    installBepInEx(): Promise<InstallResult>
    installPlugin(): Promise<InstallResult>
    /** Reveals BepInEx/LogOutput.log in the OS file browser. */
    openLogs(): Promise<InstallResult>
  }
  window: {
    setAlwaysOnTop(value: boolean): Promise<boolean>
  }
  app: {
    version: string
  }
}

declare global {
  interface Window {
    planetNav: PlanetNavApi
  }
}
