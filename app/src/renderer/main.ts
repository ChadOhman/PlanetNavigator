import 'ol/ol.css'
import './styles.css'

import type { ApiPosition } from '@shared/api'
import { getPlanetDef, type PlanetVariant } from '@shared/planets'
import type { PoiCategory } from '@shared/poiGroups'
import { ModClient } from './api/client'
import { createPlanetMap, type PlanetMap } from './map/createMap'
import { flushSave, loadPoiCache, mergeScan, scheduleSave } from './state/poiCache'
import { store } from './state/store'
import { resolveVariant } from './state/variant'
import { mountFilterChips } from './ui/FilterChips'
import { mountNearbyList } from './ui/NearbyList'
import { mountSettingsPane, watchConnectionHint } from './ui/SettingsPane'
import { mountStatusBadge } from './ui/StatusBadge'
import { mountToolbar } from './ui/Toolbar'
import { showToast } from './ui/toast'

const $ = (id: string): HTMLElement => {
  const el = document.getElementById(id)
  if (!el) throw new Error(`#${id} missing from index.html`)
  return el
}

const mapWrap = $('map-wrap')
const mapEl = $('map')
const client = new ModClient()

let planetMap: PlanetMap | null = null
/** Bumped on every planet switch so stale async work can bail out. */
let planetToken = 0
/** Last scanId merged for the current planet (used as `since`). */
let lastScanId: number | null = null
let poisInFlight = false
let poisQueued = false

function effectiveVariant(): PlanetVariant | null {
  const { planet, variant, lastPosition, status } = store.get()
  if (!planet) return null
  const ti = lastPosition?.ti ?? status?.ti
  return resolveVariant(variant, planet, ti, status?.lushThreshold)
}

// ---- planet / map lifecycle ---------------------------------------------------

async function ensurePlanet(planetId: string): Promise<void> {
  if (store.get().planet === planetId) return
  const token = ++planetToken
  flushSave()
  planetMap?.destroy()
  planetMap = null
  lastScanId = null
  store.set({ planet: planetId, pois: new Map() })
  document.title = `PlanetNavigator — ${getPlanetDef(planetId).name}`

  const variant = effectiveVariant() ?? 'barren'
  const [pm, cache] = await Promise.all([
    createPlanetMap(mapEl, getPlanetDef(planetId), variant),
    loadPoiCache(planetId)
  ])
  if (token !== planetToken) {
    pm.destroy()
    return
  }
  planetMap = pm
  mapWrap.classList.remove('empty')
  pm.poiLayer.setVisibility(store.get())
  store.set({ pois: cache })
  pm.poiLayer.setPois(cache)
  const pos = store.get().lastPosition
  if (pos) applyPosition(pos)
  void refreshPois()
}

function applyPosition(pos: ApiPosition): void {
  if (!planetMap || pos.planet !== planetMap.planet.id) return
  planetMap.playerLayer.update(pos.players)
  const me = planetMap.playerLayer.localPlayer
  if (me && store.get().follow) planetMap.view.setCenter([me.x, me.z])
}

async function refreshPois(): Promise<void> {
  if (!client.baseUrl) return
  if (poisInFlight) {
    poisQueued = true
    return
  }
  poisInFlight = true
  const token = planetToken
  try {
    const res = await client.fetchPois(lastScanId)
    const planet = store.get().planet
    if (!res || token !== planetToken || res.planet !== planet || !planet) return
    lastScanId = res.scanId
    const me = store.get().lastPosition?.players.find((p) => p.isLocal) ?? null
    const merged = mergeScan(store.get().pois, res.items, me)
    store.set({ pois: merged })
    scheduleSave(planet, merged)
  } catch (err) {
    console.warn('[main] fetchPois failed', err)
  } finally {
    poisInFlight = false
    if (poisQueued) {
      poisQueued = false
      void refreshPois()
    }
  }
}

async function refreshStatus(): Promise<void> {
  try {
    const status = await client.fetchStatus()
    store.set({ status })
    if (status.planet) void ensurePlanet(status.planet)
  } catch (err) {
    console.warn('[main] fetchStatus failed', err)
  }
}

// ---- store → map ----------------------------------------------------------------

store.subscribe((s, prev) => {
  if (!planetMap) return
  if (s.pois !== prev.pois) planetMap.poiLayer.setPois(s.pois)
  if (
    s.enabledCategories !== prev.enabledCategories ||
    s.disabledGroups !== prev.disabledGroups ||
    s.hideStored !== prev.hideStored
  )
    planetMap.poiLayer.setVisibility(s)
  if (s.follow && !prev.follow) {
    const me = planetMap.playerLayer.localPlayer
    if (me) planetMap.view.animate({ center: [me.x, me.z], duration: 200 })
  }
  const v = effectiveVariant()
  if (v && v !== planetMap.variant) void planetMap.setVariant(v)
})

// ---- settings ↔ filters -------------------------------------------------------------

/** Reads persisted filter preferences once at startup. `enabledCategories`/`disabledGroups`
 *  always come back sanitized (defaulted to `DEFAULT_ENABLED_CATEGORIES` when absent) by
 *  `src/main/settings.ts`, so no client-side fallback is needed here. */
async function hydrateFilters(): Promise<void> {
  const api = (window as Partial<Window>).planetNav
  if (!api) return
  try {
    const settings = await api.settings.get()
    store.set({
      hideStored: settings.hideStoredItems,
      enabledCategories: new Set(settings.enabledCategories as PoiCategory[]),
      disabledGroups: new Set(settings.disabledGroups)
    })
  } catch (err) {
    console.warn('[main] settings load failed', err)
  }
}
void hydrateFilters()

store.subscribe((s, prev) => {
  if (
    s.hideStored === prev.hideStored &&
    s.enabledCategories === prev.enabledCategories &&
    s.disabledGroups === prev.disabledGroups
  )
    return
  const api = (window as Partial<Window>).planetNav
  if (!api) return
  const patch: { hideStoredItems?: boolean; enabledCategories?: string[]; disabledGroups?: string[] } = {}
  if (s.hideStored !== prev.hideStored) patch.hideStoredItems = s.hideStored
  if (s.enabledCategories !== prev.enabledCategories)
    patch.enabledCategories = Array.from(s.enabledCategories)
  if (s.disabledGroups !== prev.disabledGroups) patch.disabledGroups = Array.from(s.disabledGroups)
  void api.settings.set(patch)
})

// ---- client events --------------------------------------------------------------

client.on('state', (connection) => {
  store.set({ connection })
  if (connection === 'menu') planetMap?.playerLayer.clear()
})
client.on('open', () => {
  // The game may have restarted (scanIds reset), so re-fetch the full current scan.
  lastScanId = null
  void refreshStatus()
  if (store.get().planet) void refreshPois()
})
client.on('position', (pos) => {
  store.set({ lastPosition: pos })
  if (pos.planet && pos.planet !== store.get().planet) void ensurePlanet(pos.planet)
  applyPosition(pos)
})
client.on('planet', (ev) => {
  if (ev.planet) void ensurePlanet(ev.planet)
  void refreshStatus()
})
client.on('pois', (ev) => {
  if (ev.planet && ev.planet !== store.get().planet) return
  void refreshPois()
})

// ---- UI ---------------------------------------------------------------------------

mountStatusBadge($('status'))
mountToolbar($('toolbar'), $('planet-label'), client, effectiveVariant)
mountFilterChips($('filters'))
mountNearbyList($('nearby'), () => planetMap)
mountSettingsPane($('toolbar'))
watchConnectionHint()

window.addEventListener('beforeunload', () => flushSave())
window.addEventListener('unhandledrejection', (ev) => {
  console.error(ev.reason)
  showToast(`Error: ${ev.reason instanceof Error ? ev.reason.message : String(ev.reason)}`, 'error')
})

client.start()
