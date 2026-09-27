// App icon generator for PlanetNavigator.
//
// Renders an inline SVG (rounded dark tile, desert-orange planet, white map-pin marker)
// with sharp at several sizes, writes app/build/icon.png (512), app/build/tray.png (32) and
// app/build/tray@2x.png (64), and assembles app/build/icon.ico by hand from PNG-compressed
// frames (no ico-encoding dependency needed - modern Windows accepts PNG payloads in ICO
// directory entries for every size).
//
// Usage:
//   node tools/make-icon.mjs           render everything
//   node tools/make-icon.mjs --check   also re-parse app/build/icon.ico and print its entries
//
// Run from the repo root via `npm run icon`.

import sharp from 'sharp'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')
const BUILD_DIR = path.join(REPO_ROOT, 'app', 'build')

const PNG_SIZES = [16, 24, 32, 48, 64, 128, 256, 512]
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]

// --- SVG source -------------------------------------------------------------------------
//
// Coordinate space is a fixed 512x512 canvas. Everything is clipped to a rounded square so
// nothing pokes out past the rounded corners. Kept deliberately simple (few flat shapes, no
// fine detail) so it still reads at 16px: a planet disc with a darker shadow crescent and a
// couple of faint terrain arcs, plus a white map-pin marker sitting on the upper right limb.

const SVG = `
<svg width="512" height="512" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <clipPath id="bgClip">
      <rect x="0" y="0" width="512" height="512" rx="96" ry="96"/>
    </clipPath>
    <radialGradient id="bgHighlight" cx="30%" cy="24%" r="80%">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.12"/>
      <stop offset="55%" stop-color="#ffffff" stop-opacity="0.03"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
    <clipPath id="planetClip">
      <circle cx="284" cy="304" r="148"/>
    </clipPath>
  </defs>

  <g clip-path="url(#bgClip)">
    <rect x="0" y="0" width="512" height="512" fill="#1b1f24"/>
    <rect x="0" y="0" width="512" height="512" fill="url(#bgHighlight)"/>

    <g clip-path="url(#planetClip)">
      <circle cx="284" cy="304" r="148" fill="#d98a3a"/>
      <circle cx="115" cy="429" r="148" fill="#9c6329"/>
      <path d="M 150 248 Q 284 208 404 256" fill="none" stroke="#000000" stroke-opacity="0.16" stroke-width="10" stroke-linecap="round"/>
      <path d="M 142 328 Q 284 298 414 336" fill="none" stroke="#ffffff" stroke-opacity="0.14" stroke-width="8" stroke-linecap="round"/>
      <path d="M 168 396 Q 276 378 374 402" fill="none" stroke="#000000" stroke-opacity="0.12" stroke-width="8" stroke-linecap="round"/>
    </g>

    <g transform="translate(340,94) scale(4.5)">
      <path
        d="M12,22 C12,22 5,13.5 5,9 A7,7 0 1 1 19,9 C19,13.5 12,22 12,22 Z"
        fill="#ffffff"
        stroke="#1b1f24"
        stroke-width="1.6"
      />
    </g>
  </g>
</svg>
`

// --- helpers ----------------------------------------------------------------------------

async function renderPng(size) {
  return sharp(Buffer.from(SVG), { density: Math.max(96, (size / 512) * 96 * 8) })
    .resize(size, size, { fit: 'contain' })
    .png()
    .toBuffer()
}

/** Builds an .ico file from a set of {size, png} entries (PNG-compressed BI_PNG frames). */
function buildIco(entries) {
  const count = entries.length
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type: 1 = icon
  header.writeUInt16LE(count, 4)

  const dirEntrySize = 16
  let offset = header.length + dirEntrySize * count
  const dirEntries = []
  const payloads = []

  for (const { size, png } of entries) {
    const entry = Buffer.alloc(dirEntrySize)
    entry.writeUInt8(size >= 256 ? 0 : size, 0) // width, 0 = 256
    entry.writeUInt8(size >= 256 ? 0 : size, 1) // height, 0 = 256
    entry.writeUInt8(0, 2) // color count
    entry.writeUInt8(0, 3) // reserved
    entry.writeUInt16LE(1, 4) // planes
    entry.writeUInt16LE(32, 6) // bit count
    entry.writeUInt32LE(png.length, 8) // size in bytes
    entry.writeUInt32LE(offset, 12) // offset from start of file
    dirEntries.push(entry)
    payloads.push(png)
    offset += png.length
  }

  return Buffer.concat([header, ...dirEntries, ...payloads])
}

/** Re-parses an .ico buffer, returning the directory entries (for verification). */
function parseIco(buf) {
  const type = buf.readUInt16LE(2)
  const count = buf.readUInt16LE(4)
  const entries = []
  for (let i = 0; i < count; i++) {
    const off = 6 + i * 16
    const width = buf.readUInt8(off) || 256
    const height = buf.readUInt8(off + 1) || 256
    const bitCount = buf.readUInt16LE(off + 6)
    const sizeInBytes = buf.readUInt32LE(off + 8)
    const dataOffset = buf.readUInt32LE(off + 12)
    entries.push({ width, height, bitCount, sizeInBytes, dataOffset })
  }
  return { type, count, entries }
}

async function main() {
  const check = process.argv.includes('--check')

  await fs.mkdir(BUILD_DIR, { recursive: true })

  const rendered = new Map()
  for (const size of PNG_SIZES) {
    rendered.set(size, await renderPng(size))
  }

  const writes = [
    ['icon.png', rendered.get(512)],
    ['tray.png', rendered.get(32)],
    ['tray@2x.png', rendered.get(64)]
  ]

  for (const [name, buf] of writes) {
    const dest = path.join(BUILD_DIR, name)
    await fs.writeFile(dest, buf)
    console.log(`wrote ${path.relative(REPO_ROOT, dest)} (${buf.length} bytes)`)
  }

  const icoEntries = ICO_SIZES.map((size) => ({ size, png: rendered.get(size) }))
  const ico = buildIco(icoEntries)
  const icoPath = path.join(BUILD_DIR, 'icon.ico')
  await fs.writeFile(icoPath, ico)
  console.log(
    `wrote ${path.relative(REPO_ROOT, icoPath)} (${ico.length} bytes, ${icoEntries.length} frames: ${ICO_SIZES.join(', ')})`
  )

  console.log('\nrendered PNG sizes:', PNG_SIZES.join(', '))

  if (check) {
    const buf = existsSync(icoPath) ? await fs.readFile(icoPath) : null
    if (!buf) {
      console.error('--check: icon.ico not found')
      process.exitCode = 1
      return
    }
    const parsed = parseIco(buf)
    console.log(`\n--check: icon.ico type=${parsed.type} count=${parsed.count}`)
    for (const e of parsed.entries) {
      console.log(
        `  ${e.width}x${e.height} bitCount=${e.bitCount} sizeInBytes=${e.sizeInBytes} dataOffset=${e.dataOffset}`
      )
    }
  }
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
