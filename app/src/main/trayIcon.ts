import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app, nativeImage, type NativeImage } from 'electron'
import { deflateSync } from 'node:zlib'

// Tray icon loading, with a dependency-free generated fallback for the rare case the real
// asset is missing (e.g. a dev checkout that hasn't run `npm run icon` yet).

/** Candidate locations for a build/ asset: the project's build/ dir in dev, or the resources
 *  dir electron-builder copies extraResources into once packaged. Electron's nativeImage
 *  auto-picks up a `<name>@2x.<ext>` sibling in the same directory for HiDPI, so as long as
 *  both files live alongside each other under either root this "just works". */
function candidatePaths(fileName: string): string[] {
  return [join(app.getAppPath(), 'build', fileName), join(process.resourcesPath, fileName)]
}

/** Loads `build/<fileName>` (dev) or `<resources>/<fileName>` (packaged) as a NativeImage,
 *  falling back to a small generated circle if neither is present. */
export function loadTrayIcon(fileName: string, fallbackSize = 32): NativeImage {
  for (const path of candidatePaths(fileName)) {
    if (!existsSync(path)) continue
    const image = nativeImage.createFromPath(path)
    if (!image.isEmpty()) return image
  }
  return nativeImage.createFromBuffer(createCircleIconPng(fallbackSize), {
    width: fallbackSize,
    height: fallbackSize
  })
}

// --- fallback: dependency-free PNG encoder for a single flat-shaded circle ---------------
//
// Only what Tray/nativeImage need: signature + IHDR/IDAT/IEND, 8-bit RGBA, filter type 0
// (None) per scanline.

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function makeCrcTable(): Uint32Array {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[n] = c >>> 0
  }
  return table
}
const CRC_TABLE = makeCrcTable()

function crc32(buf: Buffer): number {
  let crc = 0xffffffff
  for (const byte of buf) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(typeAndData), 0)
  return Buffer.concat([length, typeAndData, crc])
}

/** Renders a flat, anti-aliased-free circle (given RGBA color) on a transparent background. */
function createCircleIconPng(
  size: number,
  color: readonly [number, number, number] = [217, 138, 58]
): Buffer {
  const bytesPerPixel = 4
  const stride = size * bytesPerPixel
  const raw = Buffer.alloc(size * (1 + stride))
  const center = (size - 1) / 2
  const radius = size / 2 - 1
  const [r, g, b] = color

  for (let y = 0; y < size; y++) {
    const rowStart = y * (1 + stride)
    raw[rowStart] = 0 // filter type: None
    for (let x = 0; x < size; x++) {
      const dx = x - center
      const dy = y - center
      const inside = dx * dx + dy * dy <= radius * radius
      const off = rowStart + 1 + x * bytesPerPixel
      if (inside) {
        raw[off] = r
        raw[off + 1] = g
        raw[off + 2] = b
        raw[off + 3] = 255
      }
      // else: already zeroed = fully transparent black
    }
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type: RGBA
  ihdr[10] = 0 // compression
  ihdr[11] = 0 // filter
  ihdr[12] = 0 // interlace

  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0))
  ])
}
