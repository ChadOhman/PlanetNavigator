import Feature, { type FeatureLike } from 'ol/Feature'
import Point from 'ol/geom/Point'
import VectorLayer from 'ol/layer/Vector'
import VectorSource from 'ol/source/Vector'
import Icon from 'ol/style/Icon'
import Style from 'ol/style/Style'

import type { CachedPoi } from '@shared/api'
import { DEFAULT_ENABLED_CATEGORIES, getPoiGroupInfo } from '@shared/poiGroups'
import { isPoiVisible, type AppState } from '../state/store'
import { HIGHLIGHT_RING, poiIcon } from './icons'

const HIGHLIGHT_ID = '__highlight__'
const HIGHLIGHT_MS = 1500

const highlightStyle = new Style({
  image: new Icon({ src: HIGHLIGHT_RING, anchor: [0.5, 0.5] }),
  zIndex: 10
})

export class PoiLayer {
  readonly source = new VectorSource<Feature<Point>>()
  readonly layer: VectorLayer<VectorSource<Feature<Point>>>
  private features = new Map<string, Feature<Point>>()
  private styleCache = new Map<string, Style>()
  private visibility: Pick<AppState, 'enabledCategories' | 'disabledGroups' | 'hideStored'> = {
    enabledCategories: new Set(DEFAULT_ENABLED_CATEGORIES),
    disabledGroups: new Set(),
    hideStored: true
  }
  private highlightTimer: number | undefined

  constructor() {
    this.layer = new VectorLayer({
      source: this.source,
      declutter: false,
      zIndex: 10,
      style: (f) => this.styleFor(f)
    })
  }

  /** Returns undefined (OL: "not rendered"; its StyleFunction type disallows null) for filtered groups. */
  private styleFor(f: FeatureLike): Style | undefined {
    if (f.get('highlight')) return highlightStyle
    const group = String(f.get('group'))
    const inStorage = !!f.get('inStorage')
    if (!isPoiVisible(this.visibility, { group, inStorage })) return undefined
    const stale = !!f.get('stale')
    const key = `${group}|${stale ? 1 : 0}|${inStorage ? 1 : 0}`
    let style = this.styleCache.get(key)
    if (!style) {
      style = new Style({
        image: new Icon({
          src: poiIcon(getPoiGroupInfo(group).color),
          anchor: [0.5, 0.5],
          opacity: stale ? 0.6 : 1,
          // Stored items (shown only when "Hide stored" is off) render smaller so they read
          // as distinct from items lying in the world.
          scale: inStorage ? 0.7 : 1
        }),
        zIndex: stale ? 0 : 1
      })
      this.styleCache.set(key, style)
    }
    return style
  }

  /** Syncs features with the cache: adds new, updates moved/stale, removes deleted. */
  setPois(pois: Map<string, CachedPoi>): void {
    const add: Feature<Point>[] = []
    for (const [id, poi] of pois) {
      const f = this.features.get(id)
      if (!f) {
        const nf = new Feature({ geometry: new Point([poi.x, poi.z]) })
        nf.setId(id)
        nf.setProperties({ group: poi.group, kind: poi.kind, stale: poi.stale, inStorage: !!poi.inStorage }, true)
        this.features.set(id, nf)
        add.push(nf)
        continue
      }
      const [x, z] = f.getGeometry()!.getCoordinates()
      if (x !== poi.x || z !== poi.z) f.getGeometry()!.setCoordinates([poi.x, poi.z])
      if (
        f.get('stale') !== poi.stale ||
        f.get('group') !== poi.group ||
        f.get('inStorage') !== !!poi.inStorage
      ) {
        f.setProperties({ group: poi.group, kind: poi.kind, stale: poi.stale, inStorage: !!poi.inStorage })
      }
    }
    for (const [id, f] of this.features) {
      if (!pois.has(id)) {
        this.source.removeFeature(f)
        this.features.delete(id)
      }
    }
    if (add.length) this.source.addFeatures(add)
  }

  /** Updates category/group/hide-stored visibility in one go; re-renders only if anything changed. */
  setVisibility(next: Pick<AppState, 'enabledCategories' | 'disabledGroups' | 'hideStored'>): void {
    if (
      this.visibility.enabledCategories === next.enabledCategories &&
      this.visibility.disabledGroups === next.disabledGroups &&
      this.visibility.hideStored === next.hideStored
    )
      return
    this.visibility = next
    this.layer.changed()
  }

  /** Shows a ring around a coordinate for ~1.5 s. */
  highlight(x: number, z: number): void {
    let f = this.source.getFeatureById(HIGHLIGHT_ID) as Feature<Point> | null
    if (f) {
      f.getGeometry()!.setCoordinates([x, z])
    } else {
      f = new Feature({ geometry: new Point([x, z]), highlight: true })
      f.setId(HIGHLIGHT_ID)
      this.source.addFeature(f)
    }
    window.clearTimeout(this.highlightTimer)
    this.highlightTimer = window.setTimeout(() => {
      const h = this.source.getFeatureById(HIGHLIGHT_ID)
      if (h) this.source.removeFeature(h as Feature<Point>)
    }, HIGHLIGHT_MS)
  }

  dispose(): void {
    window.clearTimeout(this.highlightTimer)
  }
}
