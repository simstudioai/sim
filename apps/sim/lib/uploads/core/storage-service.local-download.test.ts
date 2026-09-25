import { Readable } from 'node:stream'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCreateReadStream, mockReadFile, mockStat } = vi.hoisted(() => ({
  mockCreateReadStream: vi.fn(),
  mockReadFile: vi.fn(),
  mockStat: vi.fn(),
}))

vi.mock('fs', () => ({ createReadStream: mockCreateReadStream }))
vi.mock('fs/promises', () => ({ readFile: mockReadFile, stat: mockStat }))

vi.mock('@/lib/uploads/config', () => ({
  USE_S3_STORAGE: false,
  USE_BLOB_STORAGE: false,
  USE_GCS_STORAGE: false,
  getStorageConfig: () => ({ bucket: 'b', region: 'r' }),
}))

vi.mock('@/lib/uploads/core/setup.server', () => ({ UPLOAD_DIR_SERVER: '/uploads' }))

vi.mock('@/lib/uploads/server/metadata', () => ({ insertFileMetadata: vi.fn() }))

import { isPayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import { downloadFile } from '@/lib/uploads/core/storage-service'

/** A stream that delivers `bytes`, whatever a prior `stat` would have claimed. */
function streamOf(bytes: number) {
  const stream = Readable.from([Buffer.alloc(bytes)]) as Readable & { destroy: () => void }
  vi.spyOn(stream, 'destroy')
  return stream
}

describe('downloadFile on local storage', () => {
  beforeEach(() => {
    mockReadFile.mockResolvedValue(Buffer.alloc(10))
  })

  it('enforces the ceiling on the bytes as they arrive, not on a prior stat', async () => {
    // The file grew (or was replaced) after any size a caller could have measured:
    // the stream delivers more than the ceiling allows, and a stat-then-read
    // implementation would have admitted it.
    mockCreateReadStream.mockReturnValue(streamOf(500))

    await expect(
      downloadFile({ key: 'workspace/ws/file.bin', context: 'workspace', maxBytes: 100 })
    ).rejects.toSatisfy(isPayloadSizeLimitError)

    expect(mockStat).not.toHaveBeenCalled()
    expect(mockReadFile).not.toHaveBeenCalled()
  })

  it('destroys the stream once the read settles', async () => {
    const stream = streamOf(50)
    mockCreateReadStream.mockReturnValue(stream)

    await downloadFile({ key: 'workspace/ws/file.bin', context: 'workspace', maxBytes: 100 })

    expect(stream.destroy).toHaveBeenCalled()
  })
})
