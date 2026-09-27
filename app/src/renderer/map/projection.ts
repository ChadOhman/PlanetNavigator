import type { Extent } from 'ol/extent'
import { addProjection } from 'ol/proj'
import Projection from 'ol/proj/Projection'

const cache = new Map<string, Projection>()

/**
 * Pixel projection `PC:<id>` for a planet, where map coordinate = [game.x, game.z].
 * Cached per planet; recreated (and re-registered) if the extent changes.
 */
export function getPlanetProjection(id: string, extent: Extent): Projection {
  const code = `PC:${id}`
  const cached = cache.get(code)
  if (cached && sameExtent(cached.getExtent(), extent)) return cached
  const proj = new Projection({ code, units: 'pixels', extent: [...extent] })
  addProjection(proj)
  cache.set(code, proj)
  return proj
}

function sameExtent(a: Extent | null, b: Extent): boolean {
  return !!a && a.length === b.length && a.every((v, i) => v === b[i])
}
