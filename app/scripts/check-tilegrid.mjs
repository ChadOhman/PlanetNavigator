// Sanity check for the tile addressing used by src/renderer/map/layers.ts.
// Mirrors ol/tilegrid/TileGrid#getTileCoordForXYAndZ_ (OL 10.10) with origin = [minX, maxZ]
// (top-left) and resolutions (maxX - minX) / (256 * 2^z), without importing OpenLayers.
// Run: node app/scripts/check-tilegrid.mjs

const TILE_SIZE = 256
const DECIMALS = 5

// OL's ol/math floor/ceil with a decimals tolerance.
const toFixed = (n, d) => {
  const f = 10 ** d
  return Math.round(n * f) / f
}
const floorD = (n, d) => Math.floor(toFixed(n, d))
const ceilD = (n, d) => Math.ceil(toFixed(n, d))

function tileCoord(extent, z, x, y, reverseIntersectionPolicy = false) {
  const [minX, , maxX, maxZ] = extent
  const origin = [minX, maxZ]
  const resolution = (maxX - minX) / (TILE_SIZE * 2 ** z)
  let tx = (x - origin[0]) / resolution / TILE_SIZE
  let ty = (origin[1] - y) / resolution / TILE_SIZE // y counts DOWN from the top edge
  if (reverseIntersectionPolicy) {
    tx = ceilD(tx, DECIMALS) - 1
    ty = ceilD(ty, DECIMALS) - 1
  } else {
    tx = floorD(tx, DECIMALS)
    ty = floorD(ty, DECIMALS)
  }
  return [tx, ty]
}

const PRIME = [-2000, -2000, 3000, 3000]
const Z = 3

const cases = [
  // Point lookup (getTileCoordForCoordAndZ): just inside the top-right corner.
  { name: 'top-right (2999, 2999)', xy: [3000 - 1, 3000 - 1], expect: [7, 0] },
  // Point lookup just inside the bottom-left corner.
  { name: 'bottom-left (-1999, -1999)', xy: [-2000 + 1, -2000 + 1], expect: [0, 7] },
  // The exact bottom-right extent corner with the reverse intersection policy, as used by
  // getTileRangeForExtentAndZ for [extent[2], extent[1]]: the last column/row of the range.
  { name: 'bottom-right extent corner (3000, -2000)', xy: [3000, -2000], reverse: true, expect: [7, 7] },
  { name: 'top-left (-2000, 3000)', xy: [-2000, 3000], expect: [0, 0] }
]

let failed = 0
for (const c of cases) {
  const got = tileCoord(PRIME, Z, c.xy[0], c.xy[1], c.reverse)
  const ok = got[0] === c.expect[0] && got[1] === c.expect[1]
  if (!ok) failed++
  console.log(`${ok ? 'ok  ' : 'FAIL'} z=${Z} ${c.name} -> (${got.join(',')}) expected (${c.expect.join(',')})`)
}

// The spec's literal (-2000, -2000) case: as a *point* OL floors it onto the row just
// outside the grid (y = 8); clamped to the grid's tile range it is the bottom-left tile.
const max = 2 ** Z - 1
const raw = tileCoord(PRIME, Z, -2000, -2000)
const clamped = raw.map((v) => Math.min(max, Math.max(0, v)))
const okClamp = clamped[0] === 0 && clamped[1] === 7
if (!okClamp) failed++
console.log(
  `${okClamp ? 'ok  ' : 'FAIL'} z=${Z} (-2000, -2000) point -> raw (${raw.join(',')}), clamped to range (${clamped.join(',')}) expected (0,7)`
)

// Every tile URL the grid can request must exist in a 2^z x 2^z pyramid.
const n = 2 ** Z
const resolution = (PRIME[2] - PRIME[0]) / (TILE_SIZE * n)
const heightTiles = Math.ceil((PRIME[3] - PRIME[1]) / resolution / TILE_SIZE)
console.log(`info grid at z=${Z}: ${n} x ${heightTiles} tiles, resolution ${resolution} units/px`)

if (failed) {
  console.error(`${failed} check(s) failed`)
  process.exit(1)
}
console.log('all tile grid checks passed')
