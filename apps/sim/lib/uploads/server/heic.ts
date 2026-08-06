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
 * Callers reach this only after a faster decoder has already failed.
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

/** JPEG quality for the transcode, on heic-convert's 0-1 scale. */
const TRANSCODE_QUALITY = 0.92

export const HEIC_TRANSCODE_MEDIA_TYPE = 'image/jpeg'

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
  return HEIF_BRANDS.has(buffer.toString('ascii', 8, 12))
}

/**
 * Transcode a HEVC-coded HEIF still to JPEG.
 *
 * Needed at two levels, neither of which has a workaround: no vision model accepts
 * HEIC (the Claude Messages API takes JPEG, PNG, GIF, and WebP only), and sharp's
 * prebuilt libvips ships libheif with AV1 support but not HEVC, so it decodes AVIF
 * and rejects an iPhone photo. `heic-convert` wraps a WebAssembly build of libheif,
 * which also keeps a historically CVE-prone parser inside the WASM sandbox rather
 * than in-process.
 *
 * Returns `null` when the bytes cannot be decoded — a corrupt or truncated upload
 * must degrade to "unreadable", never to a partial image the model would describe
 * with false confidence.
 */
export async function transcodeHeicToJpeg(buffer: Buffer): Promise<Buffer | null> {
  try {
    const convert = (await import('heic-convert')).default
    const jpeg = await convert({ buffer, format: 'JPEG', quality: TRANSCODE_QUALITY })
    return Buffer.from(jpeg)
  } catch (error) {
    logger.warn('Failed to transcode HEIC image', {
      bytes: buffer.length,
      error: getErrorMessage(error),
    })
    return null
  }
}
