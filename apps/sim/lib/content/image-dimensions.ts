/**
 * Minimal intrinsic-dimension reader for the raster formats that are valid as
 * social preview images: PNG, JPEG, WebP, and GIF.
 *
 * This replaces the `image-size` package, which is archived upstream and
 * carries unpatched high-severity DoS advisories (GHSA-w3rx-r6r6-pgpr,
 * GHSA-5p2g-fcmc-qvqq) in its ICNS/JXL/HEIF parsers — formats this app never
 * reads. Only the JPEG marker scan loops at all, and it advances on every
 * iteration regardless of the declared lengths (see `readJpeg`); the rest are
 * fixed-offset header reads.
 *
 * SVG and ICO are deliberately unsupported: neither is accepted as an
 * `og:image` by the major social crawlers, and reading SVG dimensions means
 * regex-matching untrusted-shaped XML, which is the failure class that
 * motivated removing the dependency in the first place. Callers are expected
 * to treat a null return as "fall back to the declared OG default".
 */

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

const GIF_SIGNATURES = new Set(['GIF87a', 'GIF89a'])

/** JPEG frame markers that carry a size record, excluding DHT/JPG/DAC. */
const JPEG_SOF_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
])

export interface ImageDimensions {
  width: number
  height: number
}

function readPng(buffer: Buffer): ImageDimensions | null {
  if (buffer.length < 24) return null
  if (buffer.subarray(12, 16).toString('latin1') !== 'IHDR') return null
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
}

/**
 * Walks the JPEG marker chain to the first start-of-frame segment.
 *
 * The scan always terminates: `offset` grows by at least 1 on every branch, and
 * a segment declaring a length below the 2-byte minimum lands the next
 * iteration back on its own length bytes, which cannot be the `0xff` a marker
 * requires. This is the property the replaced `image-size` parsers lacked.
 */
function readJpeg(buffer: Buffer): ImageDimensions | null {
  let offset = 2
  while (offset + 3 < buffer.length) {
    if (buffer[offset] !== 0xff) return null
    const marker = buffer[offset + 1]
    if (marker === 0xff) {
      offset += 1
      continue
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      offset += 2
      continue
    }
    const segmentLength = buffer.readUInt16BE(offset + 2)
    if (JPEG_SOF_MARKERS.has(marker)) {
      if (offset + 9 > buffer.length) return null
      return { width: buffer.readUInt16BE(offset + 7), height: buffer.readUInt16BE(offset + 5) }
    }
    offset += 2 + segmentLength
  }
  return null
}

function readGif(buffer: Buffer): ImageDimensions | null {
  if (buffer.length < 10) return null
  return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) }
}

function readWebp(buffer: Buffer): ImageDimensions | null {
  const chunkType = buffer.subarray(12, 16).toString('latin1')

  if (chunkType === 'VP8X') {
    if (buffer.length < 30) return null
    return {
      width: buffer.readUIntLE(24, 3) + 1,
      height: buffer.readUIntLE(27, 3) + 1,
    }
  }

  if (chunkType === 'VP8L') {
    if (buffer.length < 25 || buffer[20] !== 0x2f) return null
    const bits = buffer.readUInt32LE(21)
    return {
      width: (bits & 0x3fff) + 1,
      height: ((bits >> 14) & 0x3fff) + 1,
    }
  }

  if (chunkType === 'VP8 ') {
    if (buffer.length < 30) return null
    if (buffer[23] !== 0x9d || buffer[24] !== 0x01 || buffer[25] !== 0x2a) return null
    return {
      width: buffer.readUInt16LE(26) & 0x3fff,
      height: buffer.readUInt16LE(28) & 0x3fff,
    }
  }

  return null
}

/**
 * Reads intrinsic pixel dimensions from a PNG, JPEG, WebP, or GIF buffer.
 * Returns null for unrecognized formats, truncated buffers, or zero-valued
 * dimensions.
 */
export function readImageDimensions(buffer: Buffer): ImageDimensions | null {
  if (buffer.length < 12) return null

  let dimensions: ImageDimensions | null = null
  if (buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    dimensions = readPng(buffer)
  } else if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    dimensions = readJpeg(buffer)
  } else if (
    buffer.subarray(0, 4).toString('latin1') === 'RIFF' &&
    buffer.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    dimensions = readWebp(buffer)
  } else if (GIF_SIGNATURES.has(buffer.subarray(0, 6).toString('latin1'))) {
    dimensions = readGif(buffer)
  }

  if (!dimensions || dimensions.width <= 0 || dimensions.height <= 0) return null
  return dimensions
}
