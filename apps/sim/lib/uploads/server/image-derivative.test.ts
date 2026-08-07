/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDownloadFile, mockUploadFile, mockTranscode } = vi.hoisted(() => ({
  mockDownloadFile: vi.fn(),
  mockUploadFile: vi.fn(),
  mockTranscode: vi.fn(),
}))

vi.mock('@/lib/uploads/core/storage-service', () => ({
  downloadFile: mockDownloadFile,
  uploadFile: mockUploadFile,
}))

vi.mock('@/lib/uploads/server/heic', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/uploads/server/heic')>()),
  transcodeHeicToJpeg: mockTranscode,
}))

import { resolveServableImageBytes } from '@/lib/uploads/server/image-derivative'

/** An ISO-BMFF `ftyp` box declaring `brand` as its major brand. */
function ftypBytes(brand: string): Buffer {
  const header = Buffer.alloc(16)
  header.writeUInt32BE(16, 0)
  header.write('ftyp', 4, 'ascii')
  header.write(brand, 8, 'ascii')
  return header
}

/** An ISO-BMFF `ftyp` box declaring a HEVC-coded HEIF still. */
function heifBytes(): Buffer {
  return ftypBytes('heic')
}

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0])

describe('resolveServableImageBytes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDownloadFile.mockRejectedValue(new Error('not found'))
    mockUploadFile.mockResolvedValue(undefined)
    mockTranscode.mockResolvedValue(JPEG)
  })

  it('leaves non-HEIF bytes untouched', async () => {
    expect(await resolveServableImageBytes(JPEG, 'workspace/ws/a.jpg')).toBeNull()
    expect(mockDownloadFile).not.toHaveBeenCalled()
    expect(mockTranscode).not.toHaveBeenCalled()
  })

  // AVIF is a HEIF container too, but AV1-coded and rendered natively by every
  // browser. Probing it would spend a storage round trip and a WebAssembly decode
  // on every request to learn nothing.
  it.each(['avif', 'avis'])('leaves the %s brand untouched without probing', async (brand) => {
    expect(await resolveServableImageBytes(ftypBytes(brand), 'workspace/ws/a.avif')).toBeNull()
    expect(mockDownloadFile).not.toHaveBeenCalled()
    expect(mockTranscode).not.toHaveBeenCalled()
    expect(mockUploadFile).not.toHaveBeenCalled()
  })

  it('transcodes and caches on a miss', async () => {
    const result = await resolveServableImageBytes(heifBytes(), 'workspace/ws/a.heic')

    expect(result).toEqual({ buffer: JPEG, contentType: 'image/jpeg' })
    expect(mockTranscode).toHaveBeenCalledOnce()
    expect(mockUploadFile).toHaveBeenCalledOnce()
  })

  it('serves the cached derivative without decoding again', async () => {
    const cached = Buffer.from([0xff, 0xd8, 0xca, 0xce])
    mockDownloadFile.mockResolvedValue(cached)

    const result = await resolveServableImageBytes(heifBytes(), 'workspace/ws/a.heic')

    expect(result).toEqual({ buffer: cached, contentType: 'image/jpeg' })
    expect(mockTranscode).not.toHaveBeenCalled()
  })

  it('keys the derivative by storage key, so replaced content misses the old entry', async () => {
    await resolveServableImageBytes(heifBytes(), 'workspace/ws/111-a.heic')
    await resolveServableImageBytes(heifBytes(), 'workspace/ws/222-a.heic')

    const [first, second] = mockUploadFile.mock.calls.map((call) => call[0].customKey)
    expect(first).not.toEqual(second)
  })

  it('still serves the image when caching the derivative fails', async () => {
    mockUploadFile.mockRejectedValue(new Error('s3 down'))

    const result = await resolveServableImageBytes(heifBytes(), 'workspace/ws/a.heic')

    expect(result).toEqual({ buffer: JPEG, contentType: 'image/jpeg' })
  })

  it('falls back to the stored bytes when the decode fails', async () => {
    mockTranscode.mockResolvedValue(null)

    expect(await resolveServableImageBytes(heifBytes(), 'workspace/ws/a.heic')).toBeNull()
    expect(mockUploadFile).not.toHaveBeenCalled()
  })
})
