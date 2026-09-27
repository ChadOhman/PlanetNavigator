import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app, ipcMain } from 'electron'

import { DEFAULT_ENABLED_CATEGORIES } from '@shared/poiGroups'

export const IPC_SETTINGS_GET = 'settings:get'
export const IPC_SETTINGS_SET = 'settings:set'

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
  /** POI categories shown on the map/list (see `PoiCategory`). Defaults to
   *  `DEFAULT_ENABLED_CATEGORIES` when absent, e.g. on first run or settings from before this
   *  field existed — the old "empty set = show everything" `enabledGroups` was never persisted. */
  enabledCategories: string[]
  /** Per-group opt-out inside an otherwise-enabled category. */
  disabledGroups: string[]
  windowBounds?: WindowBounds
}

const DEFAULTS: AppSettings = {
  alwaysOnTop: false,
  startMinimized: false,
  windowOpacity: 1,
  gameDir: null,
  port: 27641,
  scanIntervalSeconds: 20,
  hideStoredItems: true,
  enabledCategories: [...DEFAULT_ENABLED_CATEGORIES],
  disabledGroups: []
}

/** Fields a renderer may set directly via `settings:set`. `gameDir` only changes through the
 *  validated `setup:pickGameDir`/install flow; `windowBounds` is only written by the main
 *  process as the window moves/resizes. */
const RENDERER_WRITABLE = [
  'alwaysOnTop',
  'startMinimized',
  'windowOpacity',
  'scanIntervalSeconds',
  'hideStoredItems',
  'enabledCategories',
  'disabledGroups'
] as const

const SAVE_DEBOUNCE_MS = 400

let cached: AppSettings | null = null
let saveTimer: NodeJS.Timeout | undefined

function settingsFile(): string {
  return join(app.getPath('userData'), 'settings.json')
}

function clampOpacity(n: number): number {
  if (!Number.isFinite(n)) return DEFAULTS.windowOpacity
  return Math.min(1, Math.max(0.4, n))
}

const MAX_STRING_ARRAY_ENTRIES = 500

/** Keeps only string entries, up to `MAX_STRING_ARRAY_ENTRIES`; anything else (missing key,
 *  non-array, non-string entries) yields `undefined` so the caller can fall back to a default. */
function sanitizeStringArray(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const out: string[] = []
  for (const v of raw) {
    if (typeof v !== 'string') continue
    out.push(v)
    if (out.length >= MAX_STRING_ARRAY_ENTRIES) break
  }
  return out
}

function sanitizeBounds(raw: unknown): WindowBounds | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const b = raw as Partial<WindowBounds>
  if (
    typeof b.x === 'number' &&
    typeof b.y === 'number' &&
    typeof b.width === 'number' &&
    typeof b.height === 'number' &&
    b.width > 0 &&
    b.height > 0
  ) {
    return { x: b.x, y: b.y, width: b.width, height: b.height }
  }
  return undefined
}

/** Fills in defaults and discards anything malformed; never throws. */
function sanitize(raw: unknown): AppSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<AppSettings>
  return {
    alwaysOnTop: typeof r.alwaysOnTop === 'boolean' ? r.alwaysOnTop : DEFAULTS.alwaysOnTop,
    startMinimized: typeof r.startMinimized === 'boolean' ? r.startMinimized : DEFAULTS.startMinimized,
    windowOpacity: clampOpacity(typeof r.windowOpacity === 'number' ? r.windowOpacity : DEFAULTS.windowOpacity),
    gameDir: typeof r.gameDir === 'string' && r.gameDir.length > 0 ? r.gameDir : null,
    port:
      typeof r.port === 'number' && Number.isInteger(r.port) && r.port > 0 && r.port < 65536
        ? r.port
        : DEFAULTS.port,
    scanIntervalSeconds:
      typeof r.scanIntervalSeconds === 'number' && r.scanIntervalSeconds > 0
        ? r.scanIntervalSeconds
        : DEFAULTS.scanIntervalSeconds,
    hideStoredItems: typeof r.hideStoredItems === 'boolean' ? r.hideStoredItems : DEFAULTS.hideStoredItems,
    enabledCategories: sanitizeStringArray(r.enabledCategories) ?? [...DEFAULTS.enabledCategories],
    disabledGroups: sanitizeStringArray(r.disabledGroups) ?? [...DEFAULTS.disabledGroups],
    windowBounds: sanitizeBounds(r.windowBounds)
  }
}

/** Reads userData/settings.json (creating in-memory defaults if missing/corrupt). Call once at startup. */
export async function loadSettings(): Promise<AppSettings> {
  try {
    const raw = await readFile(settingsFile(), 'utf8')
    cached = sanitize(JSON.parse(raw))
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn('[settings] failed to load settings.json:', err)
    }
    cached = { ...DEFAULTS }
  }
  return cached
}

/** Synchronous read of the in-memory settings. `loadSettings()` must have resolved first. */
export function getSettings(): AppSettings {
  return cached ?? { ...DEFAULTS }
}

async function writeSettingsFile(s: AppSettings): Promise<void> {
  const file = settingsFile()
  await mkdir(app.getPath('userData'), { recursive: true })
  const tmp = `${file}.tmp`
  await writeFile(tmp, JSON.stringify(s, null, 2), 'utf8')
  await rename(tmp, file)
}

function saveDebounced(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = undefined
    const snapshot = cached
    if (snapshot) void writeSettingsFile(snapshot).catch((err) => console.warn('[settings] save failed:', err))
  }, SAVE_DEBOUNCE_MS)
}

export type SettingsListener = (settings: AppSettings) => void
const listeners = new Set<SettingsListener>()

/** Notified after every successful `updateSettings()` call (including window bounds). */
export function onSettingsChange(fn: SettingsListener): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** Merges, sanitizes, persists (debounced) and notifies listeners. Safe to call from main-process
 *  code with any partial, including `gameDir`/`windowBounds` (only renderer IPC is restricted). */
export function updateSettings(partial: Partial<AppSettings>): AppSettings {
  const next = sanitize({ ...getSettings(), ...partial })
  cached = next
  saveDebounced()
  for (const fn of listeners) fn(next)
  return next
}

function sanitizeRendererPartial(raw: unknown): Partial<AppSettings> {
  if (!raw || typeof raw !== 'object') return {}
  const src = raw as Record<string, unknown>
  const out: Partial<AppSettings> = {}
  for (const key of RENDERER_WRITABLE) {
    if (!(key in src)) continue
    const value = src[key]
    if (key === 'windowOpacity' && typeof value === 'number') out.windowOpacity = clampOpacity(value)
    else if (key === 'alwaysOnTop' && typeof value === 'boolean') out.alwaysOnTop = value
    else if (key === 'startMinimized' && typeof value === 'boolean') out.startMinimized = value
    else if (key === 'scanIntervalSeconds' && typeof value === 'number' && value > 0)
      out.scanIntervalSeconds = value
    else if (key === 'hideStoredItems' && typeof value === 'boolean') out.hideStoredItems = value
    else if (key === 'enabledCategories') {
      const arr = sanitizeStringArray(value)
      if (arr) out.enabledCategories = arr
    } else if (key === 'disabledGroups') {
      const arr = sanitizeStringArray(value)
      if (arr) out.disabledGroups = arr
    }
  }
  return out
}

export function registerSettingsIpc(): void {
  ipcMain.handle(IPC_SETTINGS_GET, () => getSettings())
  ipcMain.handle(IPC_SETTINGS_SET, (_event, partial: unknown) =>
    updateSettings(sanitizeRendererPartial(partial))
  )
}
