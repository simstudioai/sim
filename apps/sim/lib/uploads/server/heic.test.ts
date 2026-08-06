/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { isHeifContainer, transcodeHeicToJpeg } from '@/lib/uploads/server/heic'

/**
 * An ISO-BMFF `ftyp` box: 4-byte size, the `ftyp` marker, the major brand, a
 * 4-byte minor version, then any compatible brands.
 */
function ftypHeader(brand: string, compatible: string[] = []): Buffer {
  const size = 16 + compatible.length * 4
  const header = Buffer.alloc(size)
  header.writeUInt32BE(size, 0)
  header.write('ftyp', 4, 'ascii')
  header.write(brand, 8, 'ascii')
  compatible.forEach((entry, index) => header.write(entry, 16 + index * 4, 'ascii'))
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

  it('detects a HEIF brand declared only among the compatible brands', () => {
    // Standards-valid: a generic major brand with the HEIF brand listed after it.
    expect(isHeifContainer(ftypHeader('isom', ['iso2', 'heic', 'mif1']))).toBe(true)
    expect(isHeifContainer(ftypHeader('mp42', ['heix']))).toBe(true)
  })

  it('rejects a box whose compatible brands are all non-HEIF', () => {
    expect(isHeifContainer(ftypHeader('isom', ['iso2', 'mp41', 'mp42']))).toBe(false)
  })

  it('does not read compatible brands past the declared box size', () => {
    const truncated = ftypHeader('isom', ['heic'])
    truncated.writeUInt32BE(16, 0)
    expect(isHeifContainer(truncated)).toBe(false)
  })

  it('rejects buffers too short to carry a brand', () => {
    expect(isHeifContainer(Buffer.alloc(0))).toBe(false)
    expect(isHeifContainer(ftypHeader('heic').subarray(0, 11))).toBe(false)
  })
})

describe('transcodeHeicToJpeg', () => {
  it('refuses to decode above the input ceiling', async () => {
    // Uploads allow 100MB; without this bound a tenant could spend an unbounded
    // WASM decode on a single read.
    const oversized = Buffer.alloc(20 * 1024 * 1024 + 1)
    expect(await transcodeHeicToJpeg(oversized)).toBeNull()
  })

  it('returns null for bytes libheif cannot decode', async () => {
    // Also proves the dynamic `heic-convert` import resolves at runtime, which no
    // amount of type-checking establishes for a lazily loaded WebAssembly module.
    expect(await transcodeHeicToJpeg(ftypHeader('heic'))).toBeNull()
  })
})
