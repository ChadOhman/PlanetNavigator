import type { ApiPoi, CachedPoi } from '@shared/api'

/** Known POIs this close (2D) to the local player that are missing from a scan are deleted. */
export const DELETE_RADIUS = 150
const SAVE_DEBOUNCE_MS = 2000

function bridge(): Window['planetNav'] | null {
  const api = (window as Partial<Window>).planetNav
  return api && typeof api.loadPois === 'function' ? api : null
}

export async function loadPoiCache(planet: string): Promise<Map<string, CachedPoi>> {
  const map = new Map<string, CachedPoi>()
  const api = bridge()
  if (!api) return map
  try {
    for (const p of await api.loadPois(planet)) {
      if (p && p.id !== undefined) map.set(String(p.id), { ...p, inStorage: p.inStorage ?? false })
    }
  } catch (err) {
    console.warn('[poiCache] load failed', err)
  }
  return map
}

/**
 * Merges a scan result into the cache (returns a new Map):
 * - seen in scan          → upsert, lastSeen = now, stale = false
 * - absent, within 150 of the local player → delete (it was mined/looted)
 * - absent, further away  → keep, stale = true
 */
export function mergeScan(
  existing: Map<string, CachedPoi>,
  items: ApiPoi[],
  player: { x: number; z: number } | null,
  now = Date.now()
): Map<string, CachedPoi> {
  const next = new Map<string, CachedPoi>()
  const seen = new Set<string>()
  for (const item of items) {
    const id = String(item.id)
    seen.add(id)
    next.set(id, { ...item, id, lastSeen: now, stale: false })
  }
  const r2 = DELETE_RADIUS * DELETE_RADIUS
  for (const [id, poi] of existing) {
    if (seen.has(id)) continue
    if (player) {
      const dx = poi.x - player.x
      const dz = poi.z - player.z
      if (dx * dx + dz * dz <= r2) continue
    }
    next.set(id, poi.stale ? poi : { ...poi, stale: true })
  }
  return next
}

let pending: { planet: string; pois: Map<string, CachedPoi> } | null = null
let timer: number | undefined

/** Debounced (2 s) save of a planet's cache. A pending save for another planet is flushed first. */
export function scheduleSave(planet: string, pois: Map<string, CachedPoi>): void {
  if (pending && pending.planet !== planet) flushSave()
  pending = { planet, pois }
  window.clearTimeout(timer)
  timer = window.setTimeout(flushSave, SAVE_DEBOUNCE_MS)
}

export function flushSave(): void {
  window.clearTimeout(timer)
  timer = undefined
  const job = pending
  pending = null
  const api = bridge()
  if (!job || !api) return
  api.savePois(job.planet, [...job.pois.values()]).catch((err: unknown) => {
    console.warn('[poiCache] save failed', err)
  })
}
