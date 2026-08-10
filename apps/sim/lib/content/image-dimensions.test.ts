/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { readImageDimensions } from '@/lib/content/image-dimensions'

function png(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(24)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer)
  buffer.writeUInt32BE(13, 8)
  buffer.write('IHDR', 12, 'latin1')
  buffer.writeUInt32BE(width, 16)
  buffer.writeUInt32BE(height, 20)
  return buffer
}

/** Builds a JPEG whose SOF0 frame is preceded by `filler` app segments. */
function jpeg(width: number, height: number, filler: Buffer = Buffer.alloc(0)): Buffer {
  const sof = Buffer.alloc(11)
  sof.writeUInt16BE(0xffc0, 0)
  sof.writeUInt16BE(8, 2)
  sof.writeUInt8(8, 4)
  sof.writeUInt16BE(height, 5)
  sof.writeUInt16BE(width, 7)
  return Buffer.concat([Buffer.from([0xff, 0xd8]), filler, sof])
}

function webpVp8x(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(30)
  buffer.write('RIFF', 0, 'latin1')
  buffer.write('WEBP', 8, 'latin1')
  buffer.write('VP8X', 12, 'latin1')
  buffer.writeUInt32LE(10, 16)
  buffer.writeUIntLE(width - 1, 24, 3)
  buffer.writeUIntLE(height - 1, 27, 3)
  return buffer
}

function webpVp8l(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(25)
  buffer.write('RIFF', 0, 'latin1')
  buffer.write('WEBP', 8, 'latin1')
  buffer.write('VP8L', 12, 'latin1')
  buffer.writeUInt8(0x2f, 20)
  buffer.writeUInt32LE(((height - 1) << 14) | (width - 1), 21)
  return buffer
}

function webpVp8(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(30)
  buffer.write('RIFF', 0, 'latin1')
  buffer.write('WEBP', 8, 'latin1')
  buffer.write('VP8 ', 12, 'latin1')
  Buffer.from([0x9d, 0x01, 0x2a]).copy(buffer, 23)
  buffer.writeUInt16LE(width, 26)
  buffer.writeUInt16LE(height, 28)
  return buffer
}

describe('readImageDimensions', () => {
  it('reads PNG dimensions from IHDR', () => {
    expect(readImageDimensions(png(1200, 630))).toEqual({ width: 1200, height: 630 })
  })

  it('reads JPEG dimensions from the SOF0 frame', () => {
    expect(readImageDimensions(jpeg(1920, 1080))).toEqual({ width: 1920, height: 1080 })
  })

  it('skips JPEG app segments before the frame', () => {
    const app0 = Buffer.alloc(18)
    app0.writeUInt16BE(0xffe0, 0)
    app0.writeUInt16BE(16, 2)
    app0.write('JFIF\0', 4, 'latin1')
    expect(readImageDimensions(jpeg(800, 400, app0))).toEqual({ width: 800, height: 400 })
  })

  it('tolerates JPEG marker padding bytes', () => {
    expect(readImageDimensions(jpeg(640, 480, Buffer.from([0xff, 0xff, 0xff])))).toEqual({
      width: 640,
      height: 480,
    })
  })

  it('reads extended WebP canvas dimensions', () => {
    expect(readImageDimensions(webpVp8x(2400, 1260))).toEqual({ width: 2400, height: 1260 })
  })

  it('reads lossless WebP dimensions', () => {
    expect(readImageDimensions(webpVp8l(1024, 768))).toEqual({ width: 1024, height: 768 })
  })

  it('reads lossy WebP dimensions', () => {
    expect(readImageDimensions(webpVp8(512, 256))).toEqual({ width: 512, height: 256 })
  })

  it('returns null for an unrecognized format', () => {
    expect(readImageDimensions(Buffer.from('not an image at all, really'))).toBeNull()
  })

  it('returns null for a truncated buffer', () => {
    expect(readImageDimensions(png(100, 100).subarray(0, 20))).toBeNull()
  })

  it('returns null when a header declares zero dimensions', () => {
    expect(readImageDimensions(png(0, 0))).toBeNull()
    expect(readImageDimensions(jpeg(0, 0))).toBeNull()
  })

  /**
   * The `image-size` advisories this parser replaces (GHSA-w3rx-r6r6-pgpr,
   * GHSA-5p2g-fcmc-qvqq) were zero-valued length fields that left the read
   * offset unchanged, hanging the event loop. Each case below must terminate.
   */
  describe('malformed-length denial-of-service inputs', () => {
    it('terminates on a JPEG segment declaring zero length', () => {
      const buffer = Buffer.alloc(64)
      buffer.writeUInt16BE(0xffd8, 0)
      buffer.writeUInt16BE(0xffe0, 2)
      buffer.writeUInt16BE(0, 4)
      expect(readImageDimensions(buffer)).toBeNull()
    })

    it('terminates on a JPEG segment declaring a length of one', () => {
      const buffer = Buffer.alloc(64)
      buffer.writeUInt16BE(0xffd8, 0)
      buffer.writeUInt16BE(0xffe0, 2)
      buffer.writeUInt16BE(1, 4)
      expect(readImageDimensions(buffer)).toBeNull()
    })

    it('rejects an ICNS buffer with a zero-valued entry length', () => {
      const buffer = Buffer.alloc(32)
      buffer.write('icns', 0, 'latin1')
      buffer.writeUInt32BE(32, 4)
      buffer.write('ic07', 8, 'latin1')
      buffer.writeUInt32BE(0, 12)
      expect(readImageDimensions(buffer)).toBeNull()
    })

    it('rejects a HEIF buffer with a zero-valued box size', () => {
      const buffer = Buffer.alloc(32)
      buffer.writeUInt32BE(0, 0)
      buffer.write('ftyp', 4, 'latin1')
      buffer.write('heic', 8, 'latin1')
      expect(readImageDimensions(buffer)).toBeNull()
    })

    it('rejects a JXL buffer with a zero-valued box size', () => {
      const buffer = Buffer.alloc(32)
      buffer.writeUInt32BE(0, 0)
      buffer.write('JXL ', 4, 'latin1')
      expect(readImageDimensions(buffer)).toBeNull()
    })
  })
})
