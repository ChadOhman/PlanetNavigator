import type { CachedPoi } from '@shared/api'
import { getPoiGroupInfo } from '@shared/poiGroups'
import type { PlanetMap } from '../map/createMap'
import { isPoiVisible, store } from '../state/store'

const MAX_ROWS = 40
const RENDER_INTERVAL_MS = 500 // 2 Hz
const ROW_HIGHLIGHT_MS = 1200

const COMPASS = [
  { arrow: '↑', name: 'N' },
  { arrow: '↗', name: 'NE' },
  { arrow: '→', name: 'E' },
  { arrow: '↘', name: 'SE' },
  { arrow: '↓', name: 'S' },
  { arrow: '↙', name: 'SW' },
  { arrow: '←', name: 'W' },
  { arrow: '↖', name: 'NW' }
]

/** 8-point compass bucket for a bearing measured clockwise from north (+z). */
export function compass(dx: number, dz: number): (typeof COMPASS)[number] {
  const deg = ((Math.atan2(dx, dz) * 180) / Math.PI + 360) % 360
  return COMPASS[Math.round(deg / 45) % 8]
}

/** Sidebar list of the 40 nearest enabled POIs, re-rendered at most twice a second. */
export function mountNearbyList(el: HTMLElement, getMap: () => PlanetMap | null): void {
  let dirty = true
  let flashId: string | null = null
  let flashUntil = 0
  store.subscribe((s, prev) => {
    if (
      s.lastPosition !== prev.lastPosition ||
      s.pois !== prev.pois ||
      s.enabledCategories !== prev.enabledCategories ||
      s.disabledGroups !== prev.disabledGroups ||
      s.hideStored !== prev.hideStored
    )
      dirty = true
  })

  el.addEventListener('click', (ev) => {
    const row = (ev.target as HTMLElement).closest<HTMLElement>('li[data-id]')
    if (!row) return
    const poi = store.get().pois.get(row.dataset.id!)
    const pm = getMap()
    if (!poi || !pm) return
    store.set({ follow: false })
    pm.view.animate({ center: [poi.x, poi.z], duration: 300 })
    pm.poiLayer.highlight(poi.x, poi.z)
    flashId = poi.id
    flashUntil = performance.now() + ROW_HIGHLIGHT_MS
    row.classList.add('flash')
    window.setTimeout(() => {
      dirty = true
    }, ROW_HIGHLIGHT_MS)
  })

  const render = (): void => {
    const state = store.get()
    const { lastPosition, pois } = state
    const me = lastPosition?.players.find((p) => p.isLocal) ?? null
    if (!me) {
      el.replaceChildren(emptyRow(pois.size ? 'Waiting for your position…' : 'No resources scanned yet'))
      return
    }
    const ranked: { poi: CachedPoi; d2: number }[] = []
    for (const poi of pois.values()) {
      if (!isPoiVisible(state, poi)) continue
      const dx = poi.x - me.x
      const dz = poi.z - me.z
      ranked.push({ poi, d2: dx * dx + dz * dz })
    }
    ranked.sort((a, b) => a.d2 - b.d2)
    const rows = ranked.slice(0, MAX_ROWS).map(({ poi, d2 }) => {
      const info = getPoiGroupInfo(poi.group)
      const dir = compass(poi.x - me.x, poi.z - me.z)
      const dy = Math.round(poi.y - me.y)
      const li = document.createElement('li')
      li.dataset.id = poi.id
      const flashing = poi.id === flashId && performance.now() < flashUntil
      li.className = [poi.stale ? 'stale' : '', flashing ? 'flash' : ''].join(' ').trim()
      li.title = `${info.label} · x ${Math.round(poi.x)}, y ${Math.round(poi.y)}, z ${Math.round(poi.z)}${poi.stale ? ' (not seen in the latest scan)' : ''}`

      const dot = document.createElement('span')
      dot.className = 'dot'
      dot.style.background = info.color
      const name = document.createElement('span')
      name.className = 'name'
      name.textContent = info.label
      if (poi.inStorage) {
        const suffix = document.createElement('small')
        suffix.className = 'stored-suffix'
        suffix.textContent = ` ${storageSuffix(poi.container)}`
        name.appendChild(suffix)
      }
      const dist = document.createElement('span')
      dist.className = 'dist'
      dist.textContent = `${Math.round(Math.sqrt(d2))} m`
      if (Math.abs(dy) >= 5) {
        const alt = document.createElement('small')
        alt.textContent = ` ${dy > 0 ? '▲' : '▼'}${Math.abs(dy)}`
        dist.appendChild(alt)
      }
      const bearing = document.createElement('span')
      bearing.className = 'bearing'
      bearing.textContent = dir.arrow
      bearing.title = dir.name
      li.append(dot, name, dist, bearing)
      return li
    })
    if (!rows.length) {
      el.replaceChildren(emptyRow(pois.size ? 'Nothing matches the filters' : 'No resources scanned yet'))
      return
    }
    el.replaceChildren(...rows)
  }

  window.setInterval(() => {
    if (!dirty) return
    dirty = false
    render()
  }, RENDER_INTERVAL_MS)
  render()
}

/** "· in Crate" when the holding container's group is known, else "· stored". */
function storageSuffix(container: string | null | undefined): string {
  if (container && container !== 'inventory') return `· in ${getPoiGroupInfo(container).label}`
  return '· stored'
}

function emptyRow(text: string): HTMLLIElement {
  const li = document.createElement('li')
  li.className = 'empty'
  li.textContent = text
  return li
}
