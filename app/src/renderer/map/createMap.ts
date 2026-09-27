import Map from 'ol/Map'
import View from 'ol/View'
import { defaults as defaultControls } from 'ol/control/defaults'
import { getCenter, type Extent } from 'ol/extent'
import type TileLayer from 'ol/layer/Tile'
import type XYZ from 'ol/source/XYZ'

import { DEFAULT_MAX_ZOOM, type PlanetDef, type PlanetVariant } from '@shared/planets'
import { store } from '../state/store'
import { showToast } from '../ui/toast'
import { createTileLayer, loadManifest, type TileManifest } from './layers'
import { PlayerLayer } from './playerLayer'
import { PoiLayer } from './poiLayer'
import { getPlanetProjection } from './projection'

export interface PlanetMap {
  readonly planet: PlanetDef
  readonly map: Map
  readonly view: View
  readonly extent: Extent
  readonly poiLayer: PoiLayer
  readonly playerLayer: PlayerLayer
  readonly variant: PlanetVariant
  /** Swaps the tile layer; the view (center/zoom) is untouched. */
  setVariant(v: PlanetVariant): Promise<void>
  destroy(): void
}

function warnMissingTiles(planet: PlanetDef, variant: PlanetVariant): void {
  showToast(`No tiles for ${planet.id}/${variant} — run npm run tiles`, 'warn', 8000)
}

async function manifestOrWarn(
  planet: PlanetDef,
  variant: PlanetVariant
): Promise<TileManifest | null> {
  const m = await loadManifest(planet.id, variant)
  if (!m) warnMissingTiles(planet, variant)
  return m
}

export async function createPlanetMap(
  target: HTMLElement,
  planet: PlanetDef,
  variant: PlanetVariant
): Promise<PlanetMap> {
  const manifest = await manifestOrWarn(planet, variant)
  const extent: Extent = manifest ? [...manifest.extent] : [...planet.extent]
  const maxZoom = manifest ? manifest.maxZoom : DEFAULT_MAX_ZOOM
  const projection = getPlanetProjection(planet.id, extent)

  let tileLayer: TileLayer<XYZ> = createTileLayer(planet, variant, manifest)
  let currentVariant = variant
  let variantToken = 0
  const poiLayer = new PoiLayer()
  const playerLayer = new PlayerLayer()

  const view = new View({
    projection,
    center: getCenter(extent),
    zoom: 2,
    minZoom: 0,
    maxZoom: maxZoom + 2,
    extent,
    constrainOnlyCenter: true,
    smoothExtentConstraint: false
  })

  const map = new Map({
    target,
    layers: [tileLayer, poiLayer.layer, playerLayer.layer],
    view,
    controls: defaultControls({
      zoom: true,
      rotate: false,
      attribution: true,
      attributionOptions: { collapsible: true, collapsed: true }
    })
  })

  // Any manual pan disables auto-follow.
  map.on('pointerdrag', () => {
    if (store.get().follow) store.set({ follow: false })
  })

  return {
    planet,
    map,
    view,
    extent,
    poiLayer,
    playerLayer,
    get variant() {
      return currentVariant
    },
    async setVariant(v) {
      if (v === currentVariant) return
      currentVariant = v
      const token = ++variantToken
      const m = await manifestOrWarn(planet, v)
      if (token !== variantToken) return
      const next = createTileLayer(planet, v, m)
      const layers = map.getLayers()
      const idx = layers.getArray().indexOf(tileLayer)
      if (idx >= 0) layers.setAt(idx, next)
      else layers.insertAt(0, next)
      tileLayer.getSource()?.dispose()
      tileLayer.dispose()
      tileLayer = next
    },
    destroy() {
      variantToken++
      poiLayer.dispose()
      map.setTarget(undefined)
      map.dispose()
    }
  }
}
