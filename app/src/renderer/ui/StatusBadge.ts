import type { ConnectionState } from '@shared/api'
import { getPlanetDef } from '@shared/planets'
import { store } from '../state/store'

const CLASSES: ConnectionState[] = ['searching', 'connected', 'menu', 'disconnected']

function label(connection: ConnectionState, planet: string | null): string {
  switch (connection) {
    case 'searching':
      return 'Searching for game…'
    case 'menu':
      return 'In menu'
    case 'connected':
      return planet ? `Connected · ${getPlanetDef(planet).name}` : 'Connected'
    case 'disconnected':
      return 'Disconnected'
  }
}

export function mountStatusBadge(el: HTMLElement): void {
  const render = (): void => {
    const { connection, planet } = store.get()
    el.textContent = label(connection, planet)
    for (const c of CLASSES) el.classList.toggle(c, c === connection)
  }
  store.subscribe((s, prev) => {
    if (s.connection !== prev.connection || s.planet !== prev.planet) render()
  })
  render()
}
