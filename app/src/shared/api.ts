/** Types for the PlanetNavigator mod HTTP API (http://127.0.0.1:27641..27646). */

export type ConnectionState = 'searching' | 'connected' | 'menu' | 'disconnected'

/** GET /api/status */
export interface ApiStatus {
  modVersion: string
  gameVersion: string
  port: number
  planet: string | null
  playerName: string
  scanId: number
  poiCount: number
  /** Terraformation index. */
  ti: number
  lushThreshold: number
  uptimeSeconds: number
  sseClients: number
}

/**
 * Game coordinates: x east/west, y altitude, z north/south.
 * `heading` is degrees clockwise from +z (Unity eulerAngles.y).
 */
export interface ApiPlayer {
  id: string
  name: string
  x: number
  y: number
  z: number
  heading: number
  isLocal: boolean
}

/** GET /api/position (204 in the main menu) and the SSE `position` event. */
export interface ApiPosition {
  t: number
  planet: string | null
  ti: number
  players: ApiPlayer[]
}

export interface ApiPoi {
  id: string
  kind: string
  group: string
  x: number
  y: number
  z: number
  /** True when held by / displayed inside a storage or furniture rather than lying in the world. */
  inStorage?: boolean
  /** Raw group id of the holding storage when known, "inventory" when known-but-unidentified, else null. */
  container?: string | null
}

/** GET /api/pois?since=<scanId> (304 when `since` equals the current scanId). */
export interface ApiPois {
  planet: string
  scanId: number
  t: number
  items: ApiPoi[]
}

/** SSE `planet` event. */
export interface ApiPlanetEvent {
  planet: string | null
}

/** SSE `pois` event: the client must then fetch /api/pois. */
export interface ApiPoisEvent {
  scanId: number
  planet: string
}

/** POST /api/command body. */
export type ApiCommand = { type: 'rescan' }

/** A POI as kept in the client-side cache. */
export interface CachedPoi extends ApiPoi {
  lastSeen: number
  stale: boolean
}
