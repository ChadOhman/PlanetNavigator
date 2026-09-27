import Feature from 'ol/Feature'
import Point from 'ol/geom/Point'
import VectorLayer from 'ol/layer/Vector'
import VectorSource from 'ol/source/Vector'
import Fill from 'ol/style/Fill'
import Icon from 'ol/style/Icon'
import Stroke from 'ol/style/Stroke'
import Style from 'ol/style/Style'
import Text from 'ol/style/Text'

import type { ApiPlayer } from '@shared/api'
import { PLAYER_ARROW, REMOTE_PLAYER_ARROW } from './icons'

interface Entry {
  feature: Feature<Point>
  style: Style
  icon: Icon
  text: Text | null
}

const DEG = Math.PI / 180

/** One feature per player (keyed by id), mutated in place on every position update. */
export class PlayerLayer {
  readonly source = new VectorSource<Feature<Point>>()
  readonly layer = new VectorLayer({
    source: this.source,
    zIndex: 20,
    updateWhileAnimating: true,
    updateWhileInteracting: true
  })
  private entries = new Map<string, Entry>()
  private local: ApiPlayer | null = null

  get localPlayer(): ApiPlayer | null {
    return this.local
  }

  update(players: ApiPlayer[]): void {
    const alive = new Set<string>()
    this.local = null
    for (const p of players) {
      const id = String(p.id)
      alive.add(id)
      if (p.isLocal) this.local = p
      let e = this.entries.get(id)
      if (!e || (e.text === null) !== p.isLocal) {
        if (e) this.source.removeFeature(e.feature)
        e = this.createEntry(p)
        this.entries.set(id, e)
        this.source.addFeature(e.feature)
      }
      e.feature.getGeometry()!.setCoordinates([p.x, p.z])
      e.icon.setRotation((p.heading || 0) * DEG)
      if (e.text && e.text.getText() !== p.name) e.text.setText(p.name)
      e.feature.changed()
    }
    for (const [id, e] of this.entries) {
      if (!alive.has(id)) {
        this.source.removeFeature(e.feature)
        this.entries.delete(id)
      }
    }
  }

  clear(): void {
    this.entries.clear()
    this.source.clear()
    this.local = null
  }

  private createEntry(p: ApiPlayer): Entry {
    const icon = new Icon({
      src: p.isLocal ? PLAYER_ARROW : REMOTE_PLAYER_ARROW,
      anchor: [0.5, 0.5],
      rotateWithView: true,
      rotation: (p.heading || 0) * DEG,
      scale: p.isLocal ? 1 : 0.85
    })
    const text = p.isLocal
      ? null
      : new Text({
          text: p.name,
          offsetY: -22,
          font: '600 12px "Segoe UI", sans-serif',
          fill: new Fill({ color: '#3ee6ff' }),
          stroke: new Stroke({ color: '#0b0d10', width: 3 })
        })
    const style = new Style({ image: icon, text: text ?? undefined, zIndex: p.isLocal ? 2 : 1 })
    const feature = new Feature({ geometry: new Point([p.x, p.z]) })
    feature.setId(`player:${p.id}`)
    feature.setStyle(style)
    return { feature, style, icon, text }
  }
}
