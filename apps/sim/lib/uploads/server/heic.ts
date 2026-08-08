import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'

const logger = createLogger('HeicTranscode')

/**
 * ISO-BMFF brands that name HEVC as the coded format outright. Every browser and
 * every vision model rejects these, so they are exactly the set worth transcoding
 * before anything else has been tried.
 */
const HEVC_HEIF_BRANDS = new Set(['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx'])

/**
 * Every ISO-BMFF brand in the HEIF family. Broader than {@link HEVC_HEIF_BRANDS}:
 * it answers "are these bytes worth handing to a HEIF decoder", not "which codec is
 * inside". `mif1`/`msf1` are generic and carry either HEVC or AV1, and `avif`/`avis`
 * are included because a decoder that already failed on them has nothing to lose.
 */
const HEIF_BRANDS = new Set([...HEVC_HEIF_BRANDS, 'mif1', 'msf1', 'avif', 'avis'])

/**
 * Byte ceiling for a fallback decode. Uploads allow 100MB, so without this a tenant
 * could push an arbitrarily large HEIF through a single-threaded WebAssembly decode.
 * 20MB leaves generous headroom over any phone photo — a 12MP iPhone HEIC is 1-4MB —
 * while bounding what one read can cost.
 *
 * This bounds file size only; {@link MAX_TRANSCODE_INPUT_PIXELS} bounds the raster,
 * which a small file can still declare to be enormous.
 */
export const MAX_TRANSCODE_INPUT_BYTES = 20 * 1024 * 1024

/**
 * Pixel ceiling for the fallback decode, checked against the container's declared
 * dimensions before any raster exists.
 *
 * Needed because the decoder allocates `width * height * 4` up front — the size is
 * taken straight from the `ispe` box and the buffer is built before the codec is
 * asked for anything, so a malformed file never has to decode to cost the memory.
 * libheif's own default ceiling is ~1.07e9 pixels (~4.3GB as RGBA), which is far too
 * loose to be the only guard.
 *
 * 100MP caps that allocation near 400MB and clears every phone camera — a 48MP
 * iPhone still is 8064x6048.
 */
const MAX_TRANSCODE_INPUT_PIXELS = 100_000_000

/** A real `ftyp` box holds a handful of brands; anything larger is malformed or hostile. */
const MAX_FTYP_BOX_BYTES = 512

/**
 * Whether an ISO-BMFF `ftyp` box names any of `brands`, as either the major brand
 * or a compatible brand.
 *
 * Sniffed rather than read off the declared type because the common case is a
 * `.heic` stored as `application/octet-stream`, where the declared type says
 * nothing at all.
 */
function declaresBrand(buffer: Buffer, brands: ReadonlySet<string>): boolean {
  if (buffer.length < 12) return false
  if (buffer.toString('ascii', 4, 8) !== 'ftyp') return false
  if (brands.has(buffer.toString('ascii', 8, 12))) return true

  // A standards-valid HEIF may carry a generic major brand such as `isom` and name
  // the HEIF brand only among the compatible brands, which follow the 4-byte
  // minor_version at offset 12 and run to the end of the box. A declared size of 0
  // or 1 (the ISO-BMFF size escapes, which `ftyp` does not use) leaves `end` below
  // the loop's start, so those simply do not scan. The size is attacker-controlled
  // and this runs on every preview, so cap it rather than trusting the declaration.
  const end = Math.min(buffer.readUInt32BE(0), buffer.length, MAX_FTYP_BOX_BYTES)
  for (let offset = 16; offset + 4 <= end; offset += 4) {
    if (brands.has(buffer.toString('ascii', offset, offset + 4))) return true
  }
  return false
}

/**
 * Whether these bytes are an ISO-BMFF container in the HEIF family, whatever codec
 * they carry. Use where a decode has already been attempted and failed — the extra
 * breadth costs nothing there, and it catches the generic `mif1` brand.
 */
export function isHeifContainer(buffer: Buffer): boolean {
  return declaresBrand(buffer, HEIF_BRANDS)
}

/**
 * Whether these bytes declare HEVC-coded HEIF. Use where the decode has *not* been
 * attempted yet and the answer decides whether to try: an AV1-coded HEIF (`avif`)
 * renders natively everywhere, so treating it as a transcode candidate only buys a
 * wasted decode and a misleading failure.
 */
export function isHevcHeifContainer(buffer: Buffer): boolean {
  return declaresBrand(buffer, HEVC_HEIF_BRANDS)
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
    // Read the declared dimensions first. `all()` parses the container and reports
    // each image's size while leaving the decode — and therefore the allocation —
    // for `decode()`, which is what makes refusing an oversized one cheap. The
    // container gets parsed twice as a result; that is a header parse against a
    // ceiling this path exists to enforce, and only on the HEVC fallback.
    const { all } = await import('heic-decode')
    const images = await all({ buffer })
    // `all()` hands back live libheif handles and, unlike the default export, leaves
    // freeing them to the caller — skipping this leaks the decoder context on the
    // WebAssembly heap once per preview. The dimensions are plain numbers, so they
    // outlive the handles safely.
    let oversized: { width: number; height: number } | undefined
    try {
      oversized = images
        .map(({ width, height }) => ({ width, height }))
        .find((image) => image.width * image.height > MAX_TRANSCODE_INPUT_PIXELS)
    } finally {
      images.dispose()
    }
    if (oversized) {
      logger.warn('Skipped HEIC transcode above the pixel ceiling', {
        width: oversized.width,
        height: oversized.height,
        pixels: oversized.width * oversized.height,
        ceiling: MAX_TRANSCODE_INPUT_PIXELS,
        bytes: buffer.length,
      })
      return null
    }

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
