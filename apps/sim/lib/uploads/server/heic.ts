import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'

const logger = createLogger('HeicTranscode')

/**
 * ISO-BMFF major brands in the HEIF family. The brand occupies bytes 8-11,
 * immediately after the `ftyp` box marker at 4-7.
 *
 * The list is deliberately broad, `avif` included. It answers "are these bytes
 * worth handing to a HEIF decoder", not "which codec is inside" — the brand cannot
 * answer the latter anyway, since `mif1` is generic and carries either HEVC or AV1.
 */
const HEIF_BRANDS = new Set([
  'heic',
  'heix',
  'heim',
  'heis',
  'hevc',
  'hevx',
  'mif1',
  'msf1',
  'avif',
  'avis',
])

/**
 * Byte ceiling for a fallback decode. Uploads allow 100MB and the vision path runs
 * sharp with `limitInputPixels: false`, so without this a tenant could push an
 * arbitrarily large HEIF through a single-threaded WebAssembly decode. 20MB leaves
 * generous headroom over any phone photo — a 12MP iPhone HEIC is 1-4MB — while
 * bounding what one read can cost.
 *
 * This bounds file size, not pixel count. A small file declaring enormous
 * dimensions is rejected during parse by libheif's own security limits.
 */
const MAX_TRANSCODE_INPUT_BYTES = 20 * 1024 * 1024

/**
 * Whether these bytes are an ISO-BMFF container in the HEIF family.
 *
 * Sniffed rather than read off the declared type because the common case is a
 * `.heic` stored as `application/octet-stream`, where the declared type says
 * nothing at all.
 */
export function isHeifContainer(buffer: Buffer): boolean {
  if (buffer.length < 12) return false
  if (buffer.toString('ascii', 4, 8) !== 'ftyp') return false
  if (HEIF_BRANDS.has(buffer.toString('ascii', 8, 12))) return true

  // A standards-valid HEIF may carry a generic major brand such as `isom` and name
  // the HEIF brand only among the compatible brands, which follow the 4-byte
  // minor_version at offset 12 and run to the end of the box. A declared size of 0
  // or 1 (the ISO-BMFF size escapes, which `ftyp` does not use) leaves `end` below
  // the loop's start, so those simply do not scan.
  const end = Math.min(buffer.readUInt32BE(0), buffer.length)
  for (let offset = 16; offset + 4 <= end; offset += 4) {
    if (HEIF_BRANDS.has(buffer.toString('ascii', offset, offset + 4))) return true
  }
  return false
}

/**
 * Transcode a HEVC-coded HEIF still to JPEG.
 *
 * Two reasons, neither with a workaround: no vision model accepts HEIC (the Claude
 * Messages API takes JPEG, PNG, GIF, and WebP only), and sharp's prebuilt libvips
 * ships libheif with AV1 but not HEVC — it decodes AVIF and rejects an iPhone photo.
 *
 * Returns `null` when the bytes cannot be decoded; never a partial image.
 */
export async function transcodeHeicToJpeg(buffer: Buffer): Promise<Buffer | null> {
  if (buffer.length > MAX_TRANSCODE_INPUT_BYTES) {
    logger.warn('Skipped HEIC transcode above the input ceiling', {
      bytes: buffer.length,
      ceiling: MAX_TRANSCODE_INPUT_BYTES,
    })
    return null
  }

  try {
    const convert = (await import('heic-convert')).default
    const jpeg = await convert({ buffer, format: 'JPEG' })
    logger.info('Transcoded HEIC image', {
      inputBytes: buffer.length,
      outputBytes: jpeg.length,
    })
    return Buffer.from(jpeg)
  } catch (error) {
    logger.warn('Failed to transcode HEIC image', {
      bytes: buffer.length,
      brand: buffer.toString('ascii', 8, 12),
      error: getErrorMessage(error),
    })
    return null
  }
}
