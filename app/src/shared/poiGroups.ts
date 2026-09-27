export type PoiCategory =
  | 'ore'
  | 'quartz'
  | 'storage'
  | 'wreck'
  | 'plant'
  | 'collectible'
  | 'food'
  | 'decor'
  | 'other'

export interface PoiGroupInfo {
  label: string
  color: string
  category: PoiCategory
}

export const CATEGORY_ORDER: PoiCategory[] = [
  'ore',
  'quartz',
  'storage',
  'wreck',
  'plant',
  'collectible',
  'food',
  'decor',
  'other'
]

export const CATEGORY_LABELS: Record<PoiCategory, string> = {
  ore: 'Ores',
  quartz: 'Quartz',
  storage: 'Storage',
  wreck: 'Wrecks',
  plant: 'Plants',
  collectible: 'Collectibles',
  food: 'Food',
  decor: 'Decor',
  other: 'Other'
}

/** Alias kept for callers that prefer the more explicit name. */
export const categoryLabel = CATEGORY_LABELS

/** Categories enabled on first run / when settings carry no `enabledCategories` yet. Loose
 *  loot (seeds, food, posters, effigy collectibles) is opt-in so it doesn't clutter a fresh
 *  install; the resources most players are actively hunting (ores, quartz, storage, wrecks)
 *  are on by default. */
export const DEFAULT_ENABLED_CATEGORIES: PoiCategory[] = ['ore', 'quartz', 'storage', 'wreck']

const g = (label: string, color: string, category: PoiCategory): PoiGroupInfo => ({
  label,
  color,
  category
})

/** Raw game group ids → display info. Grabable ore chunks (e.g. loose "Iron" lying on the
 *  ground) share group ids with minable nodes, so they stay in `ore` alongside them. */
export const POI_GROUPS: Record<string, PoiGroupInfo> = {
  Iron: g('Iron', '#c8703f', 'ore'),
  Cobalt: g('Cobalt', '#3d6bff', 'ore'),
  Silicon: g('Silicon', '#a9bccf', 'ore'),
  Magnesium: g('Magnesium', '#efe8c8', 'ore'),
  Titanium: g('Titanium', '#8fd3ff', 'ore'),
  Aluminium: g('Aluminium', '#dfe4ea', 'ore'),
  Iridium: g('Iridium', '#ff9f1c', 'ore'),
  Uranim: g('Uranium', '#7dff4d', 'ore'),
  Osmium: g('Osmium', '#4fe3cf', 'ore'),
  Sulfur: g('Sulfur', '#f5e04a', 'ore'),
  Zeolite: g('Zeolite', '#f2a7c3', 'ore'),
  Obsidian: g('Obsidian', '#9a7fd1', 'ore'),
  Alloy: g('Super Alloy', '#ff5d8f', 'ore'),
  ice: g('Ice', '#cfeeff', 'ore'),
  PulsarQuartz: g('Pulsar Quartz', '#ff6ad5', 'quartz'),
  QuasarQuartz: g('Quasar Quartz', '#b18cff', 'quartz'),
  SolarQuartz: g('Solar Quartz', '#ffd166', 'quartz'),
  MagnetarQuartz: g('Magnetar Quartz', '#ff5252', 'quartz'),
  BlazarQuartz: g('Blazar Quartz', '#4dd2ff', 'quartz'),
  Container1: g('Crate', '#b48a5a', 'storage'),
  Container2: g('Locker', '#8fa3bb', 'storage'),
  GoldenContainer: g('Golden Crate', '#ffd700', 'storage'),
  WreckWardrobe: g('Wreck Wardrobe', '#c49a6c', 'wreck'),
  Server: g('Server', '#6fb6ff', 'wreck'),
  RocketReactor: g('Rocket Reactor', '#ff7a45', 'other'),
  canister: g('Canister', '#9be7a0', 'other'),
  // Plants: raw seeds and the growable plots they turn into.
  Vegetable0Seed: g('Vegetable Seed', '#8fd15c', 'plant'),
  Vegetable3Seed: g('Vegetable Seed (III)', '#6fbf46', 'plant'),
  CookCocoaSeed: g('Cocoa Seed', '#a9784f', 'plant'),
  Vegetable0Growable: g('Vegetable Plant', '#79c94c', 'plant'),
  Vegetable1Growable: g('Vegetable Plant (II)', '#79c94c', 'plant'),
  Vegetable2Growable: g('Vegetable Plant (III)', '#79c94c', 'plant'),
  Vegetable3Growable: g('Vegetable Plant (IV)', '#79c94c', 'plant'),
  Seed2Growable: g('Sprouting Seed (II)', '#8fd15c', 'plant'),
  Seed3Growable: g('Sprouting Seed (III)', '#8fd15c', 'plant'),
  SeedGoldGrowable: g('Golden Sprout', '#e6c94f', 'plant'),
  // Collectibles: cosmetic effigies.
  GoldenEffigie1: g('Golden Effigy', '#ffd700', 'collectible'),
  AnimalEffigie1: g('Animal Effigy I', '#e0a672', 'collectible'),
  AnimalEffigie3: g('Animal Effigy III', '#e0a672', 'collectible'),
  AnimalEffigie7: g('Animal Effigy VII', '#e0a672', 'collectible'),
  AnimalEffigie9: g('Animal Effigy IX', '#e0a672', 'collectible'),
  // Food.
  astrofood: g('Astrofood', '#f2b84b', 'food'),
  astrofood2: g('Astrofood II', '#f2b84b', 'food'),
  // Decor.
  Poster3: g('Poster III', '#c9a0dc', 'decor'),
  Poster4: g('Poster IV', '#c9a0dc', 'decor'),
  Poster5: g('Poster V', '#c9a0dc', 'decor')
}

const UNKNOWN_COLOR = '#8b949e'

/** Substrings of known ore/mineral element names, used to bucket unlisted ore-chunk ids. */
const ORE_KEYWORDS = [
  'iron',
  'cobalt',
  'silicon',
  'magnesium',
  'titanium',
  'aluminium',
  'iridium',
  'uranium',
  'osmium',
  'sulfur',
  'zeolite',
  'obsidian',
  'alloy',
  'ice'
]

function guessCategory(id: string): PoiCategory {
  const s = id.toLowerCase()
  if (s.includes('effigie')) return 'collectible'
  if (s.includes('seed') || s.includes('growable')) return 'plant'
  if (s.includes('astrofood') || s.includes('cook')) return 'food'
  if (s.includes('poster')) return 'decor'
  if (s.includes('quartz')) return 'quartz'
  if (s.includes('container') || s.includes('chest')) return 'storage'
  if (s.includes('wreck')) return 'wreck'
  if (s.includes('plant') || s.includes('tree') || s.includes('flower')) return 'plant'
  if (ORE_KEYWORDS.some((k) => s.includes(k))) return 'ore'
  return 'other'
}

const unknownCache = new Map<string, PoiGroupInfo>()

/** Display info for any group id; unknown ids are grey and labelled with their raw id, with
 *  their category inferred from common naming patterns (see `guessCategory`). */
export function getPoiGroupInfo(id: string): PoiGroupInfo {
  const known = POI_GROUPS[id]
  if (known) return known
  let info = unknownCache.get(id)
  if (!info) {
    info = g(id, UNKNOWN_COLOR, guessCategory(id))
    unknownCache.set(id, info)
  }
  return info
}
