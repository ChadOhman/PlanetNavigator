import { PRIME_ENDGAME_TI, getPlanetDef, type PlanetVariant } from '@shared/planets'
import type { VariantChoice } from './store'

/**
 * Resolves the variant to display. Auto: lush once ti >= lushThreshold (both > 0),
 * Prime switches to endgame at ti >= 425e9, otherwise barren. Falls back to a variant the
 * planet actually has.
 */
export function resolveVariant(
  choice: VariantChoice,
  planetId: string,
  ti: number | null | undefined,
  lushThreshold: number | null | undefined
): PlanetVariant {
  const def = getPlanetDef(planetId)
  let v: PlanetVariant
  if (choice !== 'auto') {
    v = choice
  } else {
    const t = ti ?? 0
    const lush = lushThreshold ?? 0
    if (planetId === 'Prime' && t >= PRIME_ENDGAME_TI) v = 'endgame'
    else if (t > 0 && lush > 0 && t >= lush) v = 'lush'
    else v = 'barren'
  }
  if (!def.variants.includes(v)) {
    v = v === 'endgame' && def.variants.includes('lush') ? 'lush' : def.variants[0]
  }
  return v
}
