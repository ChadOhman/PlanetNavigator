import TileLayer from 'ol/layer/Tile'
import XYZ from 'ol/source/XYZ'
import TileGrid from 'ol/tilegrid/TileGrid'

import type { PlanetDef, PlanetVariant } from '@shared/planets'
import { getPlanetProjection } from './projection'

export interface TileManifest {
  planet: string
  variant: string
  tileSize: number
  maxZoom: number
  /** [minX, minZ, maxX, maxZ] in game coordinates. */
  extent: [number, number, number, number]
  format: string
}

export const TILE_SIZE = 256
export const ATTRIBUTION = 'Map imagery © akarnokd/ThePlanetCrafterMods (Apache-2.0)'

/**
 * Loads JSON relative to the page. Uses XMLHttpRequest rather than fetch() because the
 * packaged app loads index.html from file://, where Chromium's fetch() refuses the scheme.
 */
export function loadJson<T>(url: string): Promise<T | null> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest()
    xhr.open('GET', url)
    xhr.responseType = 'text'
    xhr.onload = () => {
      // file:// responses report status 0 on success.
      const ok = (xhr.status >= 200 && xhr.status < 300) || (xhr.status === 0 && xhr.responseText)
      if (!ok) return resolve(null)
      try {
        resolve(JSON.parse(xhr.responseText) as T)
      } catch {
        resolve(null)
      }
    }
    xhr.onerror = () => resolve(null)
    xhr.send()
  })
}

export function manifestUrl(planetId: string, variant: PlanetVariant): string {
  return `tiles/${planetId}/${variant}/manifest.json`
}

export async function loadManifest(
  planetId: string,
  variant: PlanetVariant
): Promise<TileManifest | null> {
  const m = await loadJson<TileManifest>(manifestUrl(planetId, variant))
  if (!m || !Array.isArray(m.extent) || m.extent.length !== 4 || !(m.maxZoom >= 0)) return null
  return m
}

/**
 * Tile grid matching the slicer: origin at the top-left corner [minX, maxZ], z=0 covers the
 * full width with one 256 px tile, each level halves the resolution.
 *
 * OL's TileGrid computes tileY = floor((origin[1] - y) / resolution / tileSize), i.e. y counts
 * downward from the origin, and XYZ substitutes tileCoord[2] straight into `{y}` — so this
 * is exactly the slicer's "y downward from the top edge" layout with no flip.
 */
export function createTileGrid(manifest: TileManifest): TileGrid {
  const [minX, , maxX, maxZ] = manifest.extent
  const tileSize = manifest.tileSize || TILE_SIZE
  const resolutions: number[] = []
  for (let z = 0; z <= manifest.maxZoom; z++) {
    resolutions.push((maxX - minX) / (tileSize * 2 ** z))
  }
  return new TileGrid({
    extent: manifest.extent,
    origin: [minX, maxZ],
    resolutions,
    tileSize
  })
}

/**
 * Tile layer for a planet variant. With no manifest (tiles not generated), the layer has no
 * source and simply renders nothing.
 */
export function createTileLayer(
  planet: PlanetDef,
  variant: PlanetVariant,
  manifest: TileManifest | null
): TileLayer<XYZ> {
  if (!manifest) {
    return new TileLayer<XYZ>({ properties: { planet: planet.id, variant } })
  }
  const format = (manifest.format || 'webp').replace(/^\./, '')
  const source = new XYZ({
    url: `tiles/${planet.id}/${variant}/{z}/{x}/{y}.${format}`,
    projection: getPlanetProjection(planet.id, manifest.extent),
    tileGrid: createTileGrid(manifest),
    attributions: ATTRIBUTION,
    transition: 0,
    wrapX: false
  })
  return new TileLayer({
    source,
    preload: 1,
    properties: { planet: planet.id, variant }
  })
}
