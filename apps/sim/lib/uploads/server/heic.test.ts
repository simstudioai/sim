/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { isHeifContainer, transcodeHeicToJpeg } from '@/lib/uploads/server/heic'

/** An ISO-BMFF header: 4-byte box size, the `ftyp` marker, then the major brand. */
function ftypHeader(brand: string): Buffer {
  const header = Buffer.alloc(16)
  header.writeUInt32BE(16, 0)
  header.write('ftyp', 4, 'ascii')
  header.write(brand, 8, 'ascii')
  return header
}

describe('isHeifContainer', () => {
  it.each(['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'mif1', 'msf1'])(
    'detects the %s brand',
    (brand) => {
      expect(isHeifContainer(ftypHeader(brand))).toBe(true)
    }
  )

  it.each(['avif', 'avis'])(
    'also claims the %s brand — the question is "is this HEIF", not "which codec"',
    (brand) => {
      expect(isHeifContainer(ftypHeader(brand))).toBe(true)
    }
  )

  it('rejects other image formats', () => {
    expect(isHeifContainer(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe(
      false
    )
    expect(isHeifContainer(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe(
      false
    )
  })

  it('rejects a HEIF brand that is not behind an ftyp box', () => {
    const riff = Buffer.alloc(16)
    riff.write('RIFF', 0, 'ascii')
    riff.write('heic', 8, 'ascii')
    expect(isHeifContainer(riff)).toBe(false)
  })

  it('rejects an unknown brand in a well-formed ftyp box', () => {
    expect(isHeifContainer(ftypHeader('qt  '))).toBe(false)
  })

  it('rejects buffers too short to carry a brand', () => {
    expect(isHeifContainer(Buffer.alloc(0))).toBe(false)
    expect(isHeifContainer(ftypHeader('heic').subarray(0, 11))).toBe(false)
  })
})

describe('transcodeHeicToJpeg', () => {
  it('returns null for bytes libheif cannot decode', async () => {
    // Also proves the dynamic `heic-convert` import resolves at runtime, which no
    // amount of type-checking establishes for a lazily loaded WebAssembly module.
    expect(await transcodeHeicToJpeg(ftypHeader('heic'))).toBeNull()
  })
})
