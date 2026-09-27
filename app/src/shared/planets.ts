export type PlanetVariant = 'barren' | 'lush' | 'endgame'

export interface PlanetDef {
  id: string
  name: string
  /**
   * Fallback [minX, minZ, maxX, maxZ] in game coordinates (map coordinate = [x, z]).
   * The tile manifest's extent takes precedence at runtime.
   */
  extent: [number, number, number, number]
  variants: PlanetVariant[]
}

/** Used when a planet's tile manifest is missing; the real value comes from manifest.json. */
export const DEFAULT_MAX_ZOOM = 3

/** Prime switches to the endgame imagery at this terraformation index. */
export const PRIME_ENDGAME_TI = 425_000_000_000

export const PLANETS: Record<string, PlanetDef> = {
  Prime: {
    id: 'Prime',
    name: 'Prime',
    extent: [-2000, -2000, 3000, 3000],
    variants: ['barren', 'lush', 'endgame']
  },
  Humble: {
    id: 'Humble',
    name: 'Humble',
    extent: [-2300, -2300, 2700, 2700],
    variants: ['barren', 'lush']
  },
  Selenea: {
    id: 'Selenea',
    name: 'Selenea',
    extent: [-2000, -2000, 3000, 3000],
    variants: ['barren', 'lush']
  },
  Aqualis: {
    id: 'Aqualis',
    name: 'Aqualis',
    extent: [-3000, -3000, 4000, 4000],
    variants: ['barren', 'lush']
  },
  Toxicity: {
    id: 'Toxicity',
    name: 'Toxicity',
    extent: [-2200, -2200, 2800, 2800],
    variants: ['barren', 'lush']
  },
  Skeo: {
    id: 'Skeo',
    name: 'Skeo',
    extent: [-4600, -200, 1900, 6300],
    variants: ['barren', 'lush']
  }
}

/** Definition for a planet id, synthesising one for planets we don't know about. */
export function getPlanetDef(id: string): PlanetDef {
  return (
    PLANETS[id] ?? {
      id,
      name: id,
      extent: [-2000, -2000, 3000, 3000],
      variants: ['barren', 'lush']
    }
  )
}

export const DEFAULT_PORT = 27641
