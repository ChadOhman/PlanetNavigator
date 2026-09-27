import type { ApiPosition, ApiStatus, CachedPoi, ConnectionState } from '@shared/api'
import { DEFAULT_ENABLED_CATEGORIES, getPoiGroupInfo, type PoiCategory } from '@shared/poiGroups'

export type VariantChoice = 'auto' | 'barren' | 'lush' | 'endgame'

export interface AppState {
  planet: string | null
  variant: VariantChoice
  follow: boolean
  /** Categories currently shown. Defaults to `DEFAULT_ENABLED_CATEGORIES` so loose loot
   *  (seeds, food, posters, effigy collectibles) stays hidden until opted into. */
  enabledCategories: Set<PoiCategory>
  /** Per-group opt-out inside an otherwise-enabled category. */
  disabledGroups: Set<string>
  /** When true, POIs held by/inside a storage or furniture are hidden from the map and list. */
  hideStored: boolean
  connection: ConnectionState
  lastPosition: ApiPosition | null
  pois: Map<string, CachedPoi>
  status: ApiStatus | null
}

export type Listener<S> = (state: S, prev: S) => void

export interface Store<S> {
  get(): S
  set(partial: Partial<S>): void
  subscribe(fn: Listener<S>): () => void
}

export function createStore<S extends object>(initial: S): Store<S> {
  let state = initial
  const listeners = new Set<Listener<S>>()
  return {
    get: () => state,
    set(partial) {
      const prev = state
      state = { ...state, ...partial }
      for (const fn of listeners) fn(state, prev)
    },
    subscribe(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    }
  }
}

/** Collections are replaced (never mutated) so subscribers can compare by reference. */
export const store = createStore<AppState>({
  planet: null,
  variant: 'auto',
  follow: true,
  enabledCategories: new Set(DEFAULT_ENABLED_CATEGORIES),
  disabledGroups: new Set(),
  hideStored: true,
  connection: 'searching',
  lastPosition: null,
  pois: new Map(),
  status: null
})

/** False when the POI's category is disabled, its group is individually opted out, or it's
 *  in storage while storage is hidden. */
export function isPoiVisible(
  state: Pick<AppState, 'enabledCategories' | 'disabledGroups' | 'hideStored'>,
  poi: { group: string; inStorage?: boolean }
): boolean {
  const info = getPoiGroupInfo(poi.group)
  if (!state.enabledCategories.has(info.category)) return false
  if (state.disabledGroups.has(poi.group)) return false
  if (state.hideStored && poi.inStorage) return false
  return true
}
