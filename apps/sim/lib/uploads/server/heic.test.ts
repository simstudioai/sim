/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  isHeifContainer,
  isHevcHeifContainer,
  transcodeHeicToJpeg,
} from '@/lib/uploads/server/heic'

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

  it('caps the scan so an inflated declared box size cannot drive the loop', () => {
    // The declared size is attacker-controlled; without the cap this scans the
    // whole buffer, and this runs on every preview request.
    const inflated = Buffer.alloc(64 * 1024)
    inflated.writeUInt32BE(0xffffffff, 0)
    inflated.write('ftyp', 4, 'ascii')
    inflated.write('isom', 8, 'ascii')
    inflated.write('heic', 60 * 1024, 'ascii')
    expect(isHeifContainer(inflated)).toBe(false)
  })

  it('rejects buffers too short to carry a brand', () => {
    expect(isHeifContainer(Buffer.alloc(0))).toBe(false)
    expect(isHeifContainer(ftypHeader('heic').subarray(0, 11))).toBe(false)
  })
})

describe('isHevcHeifContainer', () => {
  it.each(['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx'])(
    'detects the %s brand, which names HEVC outright',
    (brand) => {
      expect(isHevcHeifContainer(ftypHeader(brand))).toBe(true)
    }
  )

  it.each(['mif1', 'msf1'])('rejects the generic %s brand — the codec is unstated', (brand) => {
    expect(isHevcHeifContainer(ftypHeader(brand))).toBe(false)
  })

  it.each(['avif', 'avis'])('rejects the AV1-coded %s brand, which browsers render', (brand) => {
    expect(isHevcHeifContainer(ftypHeader(brand))).toBe(false)
  })

  it('detects an HEVC brand declared only among the compatible brands', () => {
    expect(isHevcHeifContainer(ftypHeader('mif1', ['heic']))).toBe(true)
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

  it('reports dimensions from `all()` without decoding, which the pixel check relies on', async () => {
    // The guard is only worth anything if `all()` exposes the declared size up front:
    // were dimensions to move behind `decode()` (as they are on the default export),
    // `width * height` would silently become NaN and the check would never reject.
    // Driven with a stub libheif so the real mapping runs without a HEVC encoder.
    const buildDecoder = (await import('heic-decode/lib.js')).default as (lib: unknown) => {
      all: (options: {
        buffer: Buffer
      }) => Promise<Array<{ width: number; height: number }> & { dispose: () => void }>
    }
    let decoded = false
    const { all } = buildDecoder({
      ready: Promise.resolve(),
      HeifDecoder: class {
        decoder = { delete: () => {} }
        decode() {
          return [
            {
              get_width: () => 30_000,
              get_height: () => 20_000,
              free: () => {},
              display: (target: unknown, cb: (t: unknown) => void) => {
                decoded = true
                cb(target)
              },
            },
          ]
        }
      },
    })

    const handles = await all({ buffer: ftypHeader('heic') })

    expect(handles[0].width * handles[0].height).toBe(600_000_000)
    expect(typeof handles.dispose).toBe('function')
    expect(decoded).toBe(false)
  })

  it('exposes `all` as a named export, which the pixel check destructures', async () => {
    // A CJS `module.exports = one; module.exports.all = all` need not surface `all`
    // as a named ESM export. If it stopped doing so the pixel check would throw,
    // get swallowed by the catch, and quietly stop guarding — with mocked tests
    // still green. Pin the real shape.
    const { all } = await import('heic-decode')
    expect(typeof all).toBe('function')
  })
})
