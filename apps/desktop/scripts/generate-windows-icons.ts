/**
 * Regenerates the committed Windows icons (`build/icon*.ico`) from the
 * per-channel 512px dock icons in `static/`, which already carry each
 * channel's outline color.
 *
 * Run from `apps/desktop` after a dock icon changes:
 *
 *   bun run scripts/generate-windows-icons.ts
 *
 * The output is committed rather than generated per build so packaging needs
 * no image toolchain on the Windows runner. `sharp` resolves from the
 * workspace root, where `apps/sim` hoists it.
 *
 * Each `.ico` holds 16–64px frames as 32-bit BMPs and the 256px frame as PNG —
 * the layout Explorer, the taskbar, resedit, and NSIS all read. The macOS
 * squircle's transparent margin is trimmed so the shape fills the Windows
 * icon grid instead of rendering visibly smaller than neighboring apps.
 */
import { writeFileSync } from 'node:fs'
import { createLogger } from '@sim/logger'
import sharp from 'sharp'
import { ALL_CHANNELS } from './channels'

const logger = createLogger('DesktopWindowsIcons')

const FRAME_SIZES = [16, 24, 32, 48, 64, 256] as const
/** Frames at or above this size are stored as PNG; smaller ones as BMP. */
const PNG_FRAME_MIN_SIZE = 256
/** Breathing room around the trimmed squircle, as a fraction of the frame. */
const FRAME_PADDING = 0.04

const ICONDIR_BYTES = 6
const ICONDIRENTRY_BYTES = 16
const BITMAPINFOHEADER_BYTES = 40

interface IconFrame {
  size: number
  data: Buffer
}

async function renderFrame(trimmed: Buffer, size: number): Promise<IconFrame> {
  const inner = Math.max(1, Math.round(size * (1 - FRAME_PADDING * 2)))
  const offset = Math.floor((size - inner) / 2)
  const resized = sharp(trimmed)
    .resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .extend({
      top: offset,
      left: offset,
      bottom: size - inner - offset,
      right: size - inner - offset,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
  if (size >= PNG_FRAME_MIN_SIZE) {
    return { size, data: await resized.png({ compressionLevel: 9 }).toBuffer() }
  }
  const rgba = await resized.ensureAlpha().raw().toBuffer()
  return { size, data: encodeBmpFrame(rgba, size) }
}

/**
 * A 32bpp bottom-up DIB with the doubled height ICO frames declare, followed by
 * an all-zero AND mask (alpha already carries transparency).
 */
function encodeBmpFrame(rgba: Buffer, size: number): Buffer {
  const maskRowBytes = Math.ceil(size / 32) * 4
  const pixelBytes = size * size * 4
  const frame = Buffer.alloc(BITMAPINFOHEADER_BYTES + pixelBytes + maskRowBytes * size)
  frame.writeUInt32LE(BITMAPINFOHEADER_BYTES, 0)
  frame.writeInt32LE(size, 4)
  frame.writeInt32LE(size * 2, 8)
  frame.writeUInt16LE(1, 12)
  frame.writeUInt16LE(32, 14)
  frame.writeUInt32LE(0, 16)
  frame.writeUInt32LE(pixelBytes, 20)
  for (let y = 0; y < size; y++) {
    const sourceRow = (size - 1 - y) * size * 4
    const targetRow = BITMAPINFOHEADER_BYTES + y * size * 4
    for (let x = 0; x < size; x++) {
      const source = sourceRow + x * 4
      const target = targetRow + x * 4
      frame[target] = rgba[source + 2]
      frame[target + 1] = rgba[source + 1]
      frame[target + 2] = rgba[source]
      frame[target + 3] = rgba[source + 3]
    }
  }
  return frame
}

function encodeIco(frames: readonly IconFrame[]): Buffer {
  const header = Buffer.alloc(ICONDIR_BYTES + ICONDIRENTRY_BYTES * frames.length)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(frames.length, 4)
  let offset = header.length
  frames.forEach((frame, index) => {
    const entry = ICONDIR_BYTES + ICONDIRENTRY_BYTES * index
    // A 256px dimension is encoded as 0.
    header.writeUInt8(frame.size >= 256 ? 0 : frame.size, entry)
    header.writeUInt8(frame.size >= 256 ? 0 : frame.size, entry + 1)
    header.writeUInt8(0, entry + 2)
    header.writeUInt8(0, entry + 3)
    header.writeUInt16LE(1, entry + 4)
    header.writeUInt16LE(32, entry + 6)
    header.writeUInt32LE(frame.data.length, entry + 8)
    header.writeUInt32LE(offset, entry + 12)
    offset += frame.data.length
  })
  return Buffer.concat([header, ...frames.map((frame) => frame.data)])
}

async function run(): Promise<void> {
  for (const channel of ALL_CHANNELS) {
    const trimmed = await sharp(channel.dockIcon).trim().png().toBuffer()
    const frames: IconFrame[] = []
    for (const size of FRAME_SIZES) {
      frames.push(await renderFrame(trimmed, size))
    }
    writeFileSync(channel.windowsIcon, encodeIco(frames))
    logger.info('Wrote Windows icon', { channel: channel.slug, path: channel.windowsIcon })
  }
}

run().catch((error) => {
  logger.error('Could not generate Windows icons', { error })
  process.exit(1)
})
