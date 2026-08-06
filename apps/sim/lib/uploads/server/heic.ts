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
 * Two reasons, neither with a workaround: no vision model accepts HEIC (the Claude
 * Messages API takes JPEG, PNG, GIF, and WebP only), and sharp's prebuilt libvips
 * ships libheif with AV1 but not HEVC — it decodes AVIF and rejects an iPhone photo.
 *
 * Returns `null` when the bytes cannot be decoded; never a partial image.
 */
export async function transcodeHeicToJpeg(buffer: Buffer): Promise<Buffer | null> {
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
