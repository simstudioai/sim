/**
 * @vitest-environment node
 *
 * The pixel ceiling in `transcodeHeicToJpeg`, tested against a stubbed decoder.
 *
 * Separate from `heic.test.ts` so that file keeps exercising the real WebAssembly
 * decoder — mocking it there would retire the one test proving the dynamic import
 * resolves. Reaching the guard for real would mean hand-building a HEVC-coded HEIF,
 * which needs an encoder this repo does not ship; stubbing the declared dimensions
 * tests the decision the guard actually makes.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockAll, mockConvert } = vi.hoisted(() => ({
  mockAll: vi.fn(),
  mockConvert: vi.fn(),
}))

vi.mock('heic-decode', () => ({ all: mockAll, default: Object.assign(vi.fn(), { all: mockAll }) }))
vi.mock('heic-convert', () => ({ default: mockConvert }))

import { transcodeHeicToJpeg } from '@/lib/uploads/server/heic'

/** An ISO-BMFF `ftyp` box declaring a HEVC-coded HEIF still. */
function heifHeader(): Buffer {
  const header = Buffer.alloc(16)
  header.writeUInt32BE(16, 0)
  header.write('ftyp', 4, 'ascii')
  header.write('heic', 8, 'ascii')
  return header
}

const MAX_TRANSCODE_INPUT_PIXELS = 100_000_000

/** `all()` returns live libheif handles plus the `dispose` that frees them. */
function handles(sizes: Array<{ width: number; height: number }>) {
  const dispose = vi.fn()
  const list = sizes.map((size) => ({ ...size, decode: vi.fn() }))
  return Object.assign(list, { dispose })
}

describe('transcodeHeicToJpeg pixel ceiling', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockConvert.mockResolvedValue(Buffer.from('jpeg-bytes'))
  })

  it.each([
    ['refused', [{ width: 30_000, height: 30_000 }]],
    ['transcoded', [{ width: 8064, height: 6048 }]],
  ])('frees the decoder handles when the image is %s', async (_outcome, sizes) => {
    // `all()` leaves freeing to the caller, so skipping it leaks the libheif
    // context on the WebAssembly heap once per preview.
    const list = handles(sizes)
    mockAll.mockResolvedValue(list)

    await transcodeHeicToJpeg(heifHeader())

    expect(list.dispose).toHaveBeenCalledTimes(1)
  })

  it('frees the decoder handles even when reading dimensions throws', async () => {
    const list = handles([{ width: 100, height: 100 }])
    Object.defineProperty(list[0], 'width', {
      get() {
        throw new Error('handle went away')
      },
    })
    mockAll.mockResolvedValue(list)

    await transcodeHeicToJpeg(heifHeader())

    expect(list.dispose).toHaveBeenCalledTimes(1)
  })

  it('refuses a container declaring more pixels than the ceiling', async () => {
    // 30000x30000 is ~900MP — the decoder would allocate ~3.4GB before the codec
    // is asked for anything, so the refusal has to happen on the declared size.
    mockAll.mockResolvedValue(handles([{ width: 30_000, height: 30_000 }]))

    expect(await transcodeHeicToJpeg(heifHeader())).toBeNull()
    expect(mockConvert).not.toHaveBeenCalled()
  })

  it('refuses when any image in a multi-image container is oversized', async () => {
    mockAll.mockResolvedValue(
      handles([
        { width: 100, height: 100 },
        { width: 30_000, height: 30_000 },
      ])
    )

    expect(await transcodeHeicToJpeg(heifHeader())).toBeNull()
    expect(mockConvert).not.toHaveBeenCalled()
  })

  it('transcodes a container at the ceiling', async () => {
    mockAll.mockResolvedValue(
      handles([{ width: MAX_TRANSCODE_INPUT_PIXELS / 10_000, height: 10_000 }])
    )

    expect(await transcodeHeicToJpeg(heifHeader())).toEqual(Buffer.from('jpeg-bytes'))
    expect(mockConvert).toHaveBeenCalledTimes(1)
  })

  it('transcodes an ordinary phone photo', async () => {
    // A 48MP iPhone still, which must stay well inside the ceiling.
    mockAll.mockResolvedValue(handles([{ width: 8064, height: 6048 }]))

    expect(await transcodeHeicToJpeg(heifHeader())).toEqual(Buffer.from('jpeg-bytes'))
    expect(mockConvert).toHaveBeenCalledTimes(1)
  })

  it('never asks the stubbed handle to decode', async () => {
    // The whole point of `all()` over `one()`: the decision is made before the
    // raster is allocated.
    const list = handles([{ width: 30_000, height: 30_000 }])
    mockAll.mockResolvedValue(list)

    await transcodeHeicToJpeg(heifHeader())

    expect(list[0].decode).not.toHaveBeenCalled()
  })
})
